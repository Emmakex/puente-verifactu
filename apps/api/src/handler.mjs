import { randomUUID } from 'node:crypto';
import { verifyWebhookSignature } from './webhook.mjs';

function header(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function json(status, body, correlationId) {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-correlation-id': correlationId,
    },
    body,
  };
}

function normalizeError(error, correlationId) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = error?.code ?? 'VF_API_INTERNAL';
  const retryable = status >= 500 || code === 'VF_AEAT_UNAVAILABLE';
  return json(status, {
    error: {
      code,
      message: status >= 500 && code === 'VF_API_INTERNAL' ? 'Internal error' : error.message,
      retryable,
      correlationId,
      details: Array.isArray(error?.details) ? error.details : [],
    },
  }, correlationId);
}

function parseJsonBody(request) {
  if (request.body == null || request.body === '') return {};
  if (typeof request.body === 'object' && !Buffer.isBuffer(request.body)) return request.body;
  try {
    return JSON.parse(Buffer.isBuffer(request.body) ? request.body.toString('utf8') : String(request.body));
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.code = 'VF_API_JSON_INVALID';
    error.status = 400;
    throw error;
  }
}

function rawBody(request) {
  if (typeof request.rawBody === 'string') return request.rawBody;
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody.toString('utf8');
  if (typeof request.body === 'string') return request.body;
  if (Buffer.isBuffer(request.body)) return request.body.toString('utf8');
  return JSON.stringify(request.body ?? {});
}

function binaryBody(request) {
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.rawBody === 'string') return Buffer.from(request.rawBody, 'binary');
  if (typeof request.body === 'string') return Buffer.from(request.body, 'binary');
  const error = new Error('Request body must contain raw file bytes');
  error.code = 'VF_IMPORT_FILE_REQUIRED';
  error.status = 400;
  throw error;
}

function requirePermission(context, permission) {
  if (!context?.permissions?.includes(permission)) {
    throw Object.assign(new Error(`Permission ${permission} is required`), {
      code: 'VF_API_FORBIDDEN',
      status: 403,
    });
  }
}

function requireAnyPermission(context, permissions) {
  if (!permissions.some((permission) => context?.permissions?.includes(permission))) {
    throw Object.assign(new Error(`One of these permissions is required: ${permissions.join(', ')}`), {
      code: 'VF_API_FORBIDDEN',
      status: 403,
    });
  }
}

function requireDataPlaneContext(context) {
  if (Array.isArray(context?.permissions) && context.permissions.length > 0) {
    throw Object.assign(new Error('Privileged control-plane credentials cannot use fiscal data-plane routes'), {
      code: 'VF_API_DATA_PLANE_FORBIDDEN',
      status: 403,
    });
  }
}

function requireIntegrationProfileScope(context, profileId) {
  if (context?.credentialKind !== 'kairoseth-data-plane') return;
  const expected = String(context?.profileId ?? '');
  const requested = String(profileId ?? '');
  if (!expected || !requested || requested !== expected) {
    throw Object.assign(new Error('Kairoseth data-plane credential is scoped to a specific IntegrationProfile'), {
      code: 'VF_API_INTEGRATION_PROFILE_SCOPE_REQUIRED',
      status: 403,
    });
  }
}

function forbidIntegrationCredential(context, purpose) {
  if (context?.credentialKind !== 'kairoseth-data-plane') return;
  throw Object.assign(new Error(`Kairoseth integration credentials cannot access ${purpose}`), {
    code: 'VF_API_INTEGRATION_CREDENTIAL_ROUTE_FORBIDDEN',
    status: 403,
  });
}

function decodedHeader(headers, name, fallback = '') {
  const value = header(headers, name);
  if (value == null) return fallback;
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

async function mappedProfile(resolveMappingProfile, context, profileId) {
  if (typeof resolveMappingProfile !== 'function') {
    throw Object.assign(new Error('Mapping profile resolver is unavailable'), { code: 'VF_API_MAPPING_RESOLVER_UNAVAILABLE', status: 500 });
  }
  const profile = await resolveMappingProfile({ context, profileId });
  if (!profile) throw Object.assign(new Error('Mapping profile not found'), { code: 'VF_API_MAPPING_PROFILE_NOT_FOUND', status: 404 });
  return profile;
}

export function createApiHandler({
  bridge,
  authenticate,
  resolveMappingProfile,
  resolveWebhookSecret,
  imports,
  localAgents = null,
  resolveOnboardingStrategy = null,
  onboardingProfiles = null,
  integrationProfiles = null,
} = {}) {
  if (!bridge) throw new TypeError('bridge is required');
  if (typeof authenticate !== 'function') throw new TypeError('authenticate is required');

  return async function handle(request) {
    const correlationId = header(request.headers, 'x-correlation-id') || randomUUID();
    try {
      const context = await authenticate(request);
      const method = String(request.method ?? 'GET').toUpperCase();
      const path = String(request.path ?? '/').split('?')[0];

      if (method === 'POST' && path === '/v1/control-plane/onboarding/resolve') {
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        if (typeof resolveOnboardingStrategy !== 'function') {
          throw Object.assign(new Error('Kairoseth onboarding resolver is unavailable'), {
            code: 'VF_ONBOARDING_RESOLVER_UNAVAILABLE',
            status: 503,
          });
        }
        return json(
          200,
          await resolveOnboardingStrategy(parseJsonBody(request)),
          correlationId,
        );
      }

      if (path === '/v1/control-plane/onboarding/profiles') {
        if (!onboardingProfiles) {
          throw Object.assign(new Error('Kairoseth onboarding profile store is unavailable'), {
            code: 'VF_ONBOARDING_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);

        if (method === 'GET') {
          return json(200, {
            schemaVersion: 1,
            profiles: await onboardingProfiles.listProfiles(context),
          }, correlationId);
        }
        if (method === 'POST') {
          return json(
            201,
            await onboardingProfiles.createProfile(context, parseJsonBody(request)),
            correlationId,
          );
        }
        throw Object.assign(new Error('Method not allowed'), {
          code: 'VF_API_METHOD_NOT_ALLOWED',
          status: 405,
        });
      }

      const onboardingProfileMatch = path.match(
        /^\/v1\/control-plane\/onboarding\/profiles\/(onb_[a-f0-9]{32})$/,
      );
      if (method === 'GET' && onboardingProfileMatch) {
        if (!onboardingProfiles) {
          throw Object.assign(new Error('Kairoseth onboarding profile store is unavailable'), {
            code: 'VF_ONBOARDING_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        return json(
          200,
          await onboardingProfiles.getProfile(context, onboardingProfileMatch[1]),
          correlationId,
        );
      }

      const onboardingIntegrationMatch = path.match(
        /^\/v1\/control-plane\/onboarding\/profiles\/(onb_[a-f0-9]{32})\/integration$/,
      );
      if (method === 'PATCH' && onboardingIntegrationMatch) {
        if (!onboardingProfiles) {
          throw Object.assign(new Error('Kairoseth onboarding profile store is unavailable'), {
            code: 'VF_ONBOARDING_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        return json(
          200,
          await onboardingProfiles.bindIntegration(
            context,
            onboardingIntegrationMatch[1],
            parseJsonBody(request),
          ),
          correlationId,
        );
      }

      const onboardingMaterializeMatch = path.match(
        /^\/v1\/control-plane\/onboarding\/profiles\/(onb_[a-f0-9]{32})\/materialize-integration$/,
      );
      if (method === 'POST' && onboardingMaterializeMatch) {
        if (!onboardingProfiles) {
          throw Object.assign(new Error('Kairoseth onboarding profile store is unavailable'), {
            code: 'VF_ONBOARDING_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        return json(
          201,
          await onboardingProfiles.materializeIntegration(
            context,
            onboardingMaterializeMatch[1],
            parseJsonBody(request),
          ),
          correlationId,
        );
      }

      const onboardingProvisionMatch = path.match(
        /^\/v1\/control-plane\/onboarding\/profiles\/(onb_[a-f0-9]{32})\/provision-local-agent$/,
      );
      if (method === 'POST' && onboardingProvisionMatch) {
        if (!onboardingProfiles) {
          throw Object.assign(new Error('Kairoseth onboarding profile store is unavailable'), {
            code: 'VF_ONBOARDING_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        return json(
          201,
          await onboardingProfiles.provisionLocalAgent(
            context,
            onboardingProvisionMatch[1],
            parseJsonBody(request),
          ),
          correlationId,
        );
      }

      if (path === '/v1/control-plane/integration-profiles') {
        if (!integrationProfiles) {
          throw Object.assign(new Error('Kairoseth integration profile store is unavailable'), {
            code: 'VF_INTEGRATION_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        if (method === 'GET') {
          return json(200, {
            schemaVersion: 1,
            profiles: await integrationProfiles.list(context),
          }, correlationId);
        }
        throw Object.assign(new Error('Method not allowed'), {
          code: 'VF_API_METHOD_NOT_ALLOWED',
          status: 405,
        });
      }

      const integrationProfileMatch = path.match(
        /^\/v1\/control-plane\/integration-profiles\/(int_[a-f0-9]{32})$/,
      );
      if (method === 'GET' && integrationProfileMatch) {
        if (!integrationProfiles) {
          throw Object.assign(new Error('Kairoseth integration profile store is unavailable'), {
            code: 'VF_INTEGRATION_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        return json(
          200,
          await integrationProfiles.get(context, integrationProfileMatch[1]),
          correlationId,
        );
      }

      const integrationMappingMatch = path.match(
        /^\/v1\/control-plane\/integration-profiles\/(int_[a-f0-9]{32})\/mapping$/,
      );
      if (method === 'PUT' && integrationMappingMatch) {
        if (!integrationProfiles) {
          throw Object.assign(new Error('Kairoseth integration profile store is unavailable'), {
            code: 'VF_INTEGRATION_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        return json(
          200,
          await integrationProfiles.setMapping(
            context,
            integrationMappingMatch[1],
            parseJsonBody(request),
          ),
          correlationId,
        );
      }

      const integrationSecretRefMatch = path.match(
        /^\/v1\/control-plane\/integration-profiles\/(int_[a-f0-9]{32})\/webhook-secret-ref$/,
      );
      if (method === 'PUT' && integrationSecretRefMatch) {
        if (!integrationProfiles) {
          throw Object.assign(new Error('Kairoseth integration profile store is unavailable'), {
            code: 'VF_INTEGRATION_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        return json(
          200,
          await integrationProfiles.setWebhookSecretReference(
            context,
            integrationSecretRefMatch[1],
            parseJsonBody(request),
          ),
          correlationId,
        );
      }

      const integrationCredentialMatch = path.match(
        /^\/v1\/control-plane\/integration-profiles\/(int_[a-f0-9]{32})\/credential$/,
      );
      if (method === 'POST' && integrationCredentialMatch) {
        if (!integrationProfiles) {
          throw Object.assign(new Error('Kairoseth integration profile store is unavailable'), {
            code: 'VF_INTEGRATION_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        return json(
          201,
          await integrationProfiles.provisionCredential(
            context,
            integrationCredentialMatch[1],
            parseJsonBody(request),
          ),
          correlationId,
        );
      }

      const integrationCredentialRotateMatch = path.match(
        /^\/v1\/control-plane\/integration-profiles\/(int_[a-f0-9]{32})\/credential\/rotate$/,
      );
      if (method === 'POST' && integrationCredentialRotateMatch) {
        if (!integrationProfiles) {
          throw Object.assign(new Error('Kairoseth integration profile store is unavailable'), {
            code: 'VF_INTEGRATION_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        return json(
          200,
          await integrationProfiles.rotateCredential(
            context,
            integrationCredentialRotateMatch[1],
            parseJsonBody(request),
          ),
          correlationId,
        );
      }

      const integrationCredentialRevokeMatch = path.match(
        /^\/v1\/control-plane\/integration-profiles\/(int_[a-f0-9]{32})\/credential\/revoke$/,
      );
      if (method === 'POST' && integrationCredentialRevokeMatch) {
        if (!integrationProfiles) {
          throw Object.assign(new Error('Kairoseth integration profile store is unavailable'), {
            code: 'VF_INTEGRATION_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        return json(
          200,
          await integrationProfiles.revokeCredential(
            context,
            integrationCredentialRevokeMatch[1],
            parseJsonBody(request),
          ),
          correlationId,
        );
      }

      const integrationDisableMatch = path.match(
        /^\/v1\/control-plane\/integration-profiles\/(int_[a-f0-9]{32})\/disable$/,
      );
      if (method === 'POST' && integrationDisableMatch) {
        if (!integrationProfiles) {
          throw Object.assign(new Error('Kairoseth integration profile store is unavailable'), {
            code: 'VF_INTEGRATION_PROFILE_STORE_UNAVAILABLE',
            status: 503,
          });
        }
        requireAnyPermission(context, ['onboarding:manage', 'agents:manage']);
        return json(
          200,
          await integrationProfiles.disable(context, integrationDisableMatch[1]),
          correlationId,
        );
      }

      if (path === '/v1/control-plane/local-agents') {
        if (!localAgents) {
          throw Object.assign(new Error('Local Agent control plane is unavailable'), {
            code: 'VF_LOCAL_AGENT_CONTROL_UNAVAILABLE',
            status: 503,
          });
        }
        requirePermission(context, 'agents:manage');

        if (method === 'GET') {
          return json(200, {
            schemaVersion: 1,
            installations: await localAgents.list(),
          }, correlationId);
        }
        if (method === 'POST') {
          return json(201, await localAgents.provision(parseJsonBody(request)), correlationId);
        }
        if (method === 'PATCH') {
          return json(200, await localAgents.setControl(parseJsonBody(request)), correlationId);
        }
        throw Object.assign(new Error('Method not allowed'), {
          code: 'VF_API_METHOD_NOT_ALLOWED',
          status: 405,
        });
      }

      if (method === 'POST' && path === '/v1/control-plane/local-agents/rotate-credential') {
        if (!localAgents) {
          throw Object.assign(new Error('Local Agent control plane is unavailable'), {
            code: 'VF_LOCAL_AGENT_CONTROL_UNAVAILABLE',
            status: 503,
          });
        }
        requirePermission(context, 'agents:manage');
        return json(200, await localAgents.rotateCredential(parseJsonBody(request)), correlationId);
      }

      if (method === 'POST' && path === '/v1/control-plane/local-agents/revoke') {
        if (!localAgents) {
          throw Object.assign(new Error('Local Agent control plane is unavailable'), {
            code: 'VF_LOCAL_AGENT_CONTROL_UNAVAILABLE',
            status: 503,
          });
        }
        requirePermission(context, 'agents:manage');
        return json(200, await localAgents.revoke(parseJsonBody(request)), correlationId);
      }

      if (method === 'POST' && path === '/v1/local-agent/heartbeat') {
        if (!localAgents) {
          throw Object.assign(new Error('Local Agent control plane is unavailable'), {
            code: 'VF_LOCAL_AGENT_CONTROL_UNAVAILABLE',
            status: 503,
          });
        }
        return json(200, await localAgents.heartbeat(context, parseJsonBody(request)), correlationId);
      }

      requireDataPlaneContext(context);

      if (method === 'POST' && path === '/v1/imports/inspect') {
        forbidIntegrationCredential(context, 'file import routes');
        if (!imports) throw Object.assign(new Error('Import service is unavailable'), { code: 'VF_IMPORT_SERVICE_UNAVAILABLE', status: 500 });
        const headerRowRaw = header(request.headers, 'x-header-row');
        const result = imports.inspect({
          buffer: binaryBody(request),
          filename: decodedHeader(request.headers, 'x-file-name', 'import'),
          sheet: decodedHeader(request.headers, 'x-sheet', '') || undefined,
          headerRow: headerRowRaw ? Number(headerRowRaw) : undefined,
          locale: header(request.headers, 'accept-language')?.toLowerCase().startsWith('en') ? 'en-US' : 'es-ES',
          context,
        });
        return json(201, result, correlationId);
      }

      const importMatch = path.match(/^\/v1\/imports\/(imp_[a-f0-9]{32})$/);
      const importPreflightMatch = path.match(/^\/v1\/imports\/(imp_[a-f0-9]{32})\/preflight$/);
      if (method === 'POST' && importPreflightMatch) {
        forbidIntegrationCredential(context, 'file import routes');
        if (!imports) throw Object.assign(new Error('Import service is unavailable'), { code: 'VF_IMPORT_SERVICE_UNAVAILABLE', status: 500 });
        const result = imports.preflight(importPreflightMatch[1], context, parseJsonBody(request));
        return json(200, result, correlationId);
      }
      if (method === 'DELETE' && importMatch) {
        forbidIntegrationCredential(context, 'file import routes');
        if (!imports) throw Object.assign(new Error('Import service is unavailable'), { code: 'VF_IMPORT_SERVICE_UNAVAILABLE', status: 500 });
        return json(200, imports.remove(importMatch[1], context), correlationId);
      }

      if (method === 'POST' && path === '/v1/preflight') {
        const body = parseJsonBody(request);
        requireIntegrationProfileScope(context, body.profileId);
        if (body.profileId) {
          const profile = await mappedProfile(resolveMappingProfile, context, body.profileId);
          return json(200, bridge.preflightMapped(body.source ?? {}, profile, context), correlationId);
        }
        return json(200, bridge.preflight(body.intent ?? body, context), correlationId);
      }

      if (method === 'POST' && path === '/v1/fiscal-records') {
        const body = parseJsonBody(request);
        requireIntegrationProfileScope(context, body.profileId);
        const idempotencyKey = header(request.headers, 'idempotency-key');
        let resource;
        if (body.profileId) {
          const profile = await mappedProfile(resolveMappingProfile, context, body.profileId);
          resource = await bridge.issueMapped(body.source ?? {}, profile, context, { idempotencyKey });
        } else {
          resource = await bridge.issue(body.intent ?? body, context, { idempotencyKey });
        }
        return json(resource.duplicate ? 200 : 202, resource, correlationId);
      }

      const recordStatusMatch = path.match(
        /^\/v1\/fiscal-records\/(fr_[a-f0-9]+)\/status$/,
      );
      if (method === 'GET' && recordStatusMatch) {
        return json(200, bridge.status(recordStatusMatch[1], context), correlationId);
      }

      const recordCancelMatch = path.match(
        /^\/v1\/fiscal-records\/(fr_[a-f0-9]+)\/cancel$/,
      );
      if (method === 'POST' && recordCancelMatch) {
        const idempotencyKey = header(request.headers, 'idempotency-key');
        const resource = await bridge.cancel(
          recordCancelMatch[1],
          parseJsonBody(request),
          context,
          { idempotencyKey },
        );
        return json(resource.duplicate ? 200 : 202, resource, correlationId);
      }

      const recordMatch = path.match(/^\/v1\/fiscal-records\/(fr_[a-f0-9]+)$/);
      if (method === 'GET' && recordMatch) return json(200, bridge.get(recordMatch[1], context), correlationId);

      const webhookMatch = path.match(/^\/v1\/webhooks\/([A-Za-z0-9._-]{1,128})$/);
      if (method === 'POST' && webhookMatch) {
        if (typeof resolveWebhookSecret !== 'function') {
          throw Object.assign(new Error('Webhook configuration is unavailable'), { code: 'VF_WEBHOOK_CONFIGURATION_UNAVAILABLE', status: 500 });
        }
        const profileId = webhookMatch[1];
        requireIntegrationProfileScope(context, profileId);
        const [profile, secret] = await Promise.all([
          mappedProfile(resolveMappingProfile, context, profileId),
          resolveWebhookSecret({ context, profileId }),
        ]);
        const raw = rawBody(request);
        verifyWebhookSignature({ rawBody: raw, headers: request.headers, secret });
        const source = parseJsonBody({ body: raw });
        const idempotencyKey = header(request.headers, 'idempotency-key') || header(request.headers, 'x-event-id');
        const resource = await bridge.issueMapped(source, profile, context, { idempotencyKey });
        return json(resource.duplicate ? 200 : 202, resource, correlationId);
      }

      return json(404, {
        error: {
          code: 'VF_API_ROUTE_NOT_FOUND',
          message: 'Route not found',
          retryable: false,
          correlationId,
          details: [],
        },
      }, correlationId);
    } catch (error) {
      return normalizeError(error, correlationId);
    }
  };
}
