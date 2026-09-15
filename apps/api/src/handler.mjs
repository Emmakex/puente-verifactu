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

export function createApiHandler({ bridge, authenticate, resolveMappingProfile, resolveWebhookSecret, imports } = {}) {
  if (!bridge) throw new TypeError('bridge is required');
  if (typeof authenticate !== 'function') throw new TypeError('authenticate is required');

  return async function handle(request) {
    const correlationId = header(request.headers, 'x-correlation-id') || randomUUID();
    try {
      const context = await authenticate(request);
      const method = String(request.method ?? 'GET').toUpperCase();
      const path = String(request.path ?? '/').split('?')[0];

      if (method === 'POST' && path === '/v1/imports/inspect') {
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
        if (!imports) throw Object.assign(new Error('Import service is unavailable'), { code: 'VF_IMPORT_SERVICE_UNAVAILABLE', status: 500 });
        const result = imports.preflight(importPreflightMatch[1], context, parseJsonBody(request));
        return json(200, result, correlationId);
      }
      if (method === 'DELETE' && importMatch) {
        if (!imports) throw Object.assign(new Error('Import service is unavailable'), { code: 'VF_IMPORT_SERVICE_UNAVAILABLE', status: 500 });
        return json(200, imports.remove(importMatch[1], context), correlationId);
      }

      if (method === 'POST' && path === '/v1/preflight') {
        const body = parseJsonBody(request);
        if (body.profileId) {
          const profile = await mappedProfile(resolveMappingProfile, context, body.profileId);
          return json(200, bridge.preflightMapped(body.source ?? {}, profile, context), correlationId);
        }
        return json(200, bridge.preflight(body.intent ?? body, context), correlationId);
      }

      if (method === 'POST' && path === '/v1/fiscal-records') {
        const body = parseJsonBody(request);
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

      const recordMatch = path.match(/^\/v1\/fiscal-records\/(fr_[a-f0-9]+)$/);
      if (method === 'GET' && recordMatch) return json(200, bridge.get(recordMatch[1], context), correlationId);

      const webhookMatch = path.match(/^\/v1\/webhooks\/([A-Za-z0-9._-]{1,128})$/);
      if (method === 'POST' && webhookMatch) {
        if (typeof resolveWebhookSecret !== 'function') {
          throw Object.assign(new Error('Webhook configuration is unavailable'), { code: 'VF_WEBHOOK_CONFIGURATION_UNAVAILABLE', status: 500 });
        }
        const profileId = webhookMatch[1];
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
