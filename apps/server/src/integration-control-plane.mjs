import { createHash } from 'node:crypto';

const PROFILE_RE = /^int_[a-f0-9]{32}$/;
const ONBOARDING_RE = /^onb_[a-f0-9]{32}$/;
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const AUTH_CHANNELS = new Set(['rest_api', 'webhook']);

function fail(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function requireOrganization(context) {
  const organizationId = String(context?.organizationId ?? '').trim();
  if (!ID_RE.test(organizationId)) {
    throw fail('VF_INTEGRATION_TENANT_CONTEXT_REQUIRED', 'Kairoseth organization context is required', 403);
  }
  return organizationId;
}

function requiredProfileId(value) {
  const id = String(value ?? '').trim();
  if (!PROFILE_RE.test(id)) throw fail('VF_INTEGRATION_PROFILE_ID_INVALID', 'Integration profile id is invalid');
  return id;
}

function deterministicProfileId(onboardingProfileId) {
  const digest = createHash('sha256')
    .update(String(onboardingProfileId))
    .digest('hex')
    .slice(0, 32);
  return `int_${digest}`;
}

function deterministicInstallationId(onboardingProfileId) {
  const digest = createHash('sha256')
    .update(`integration-installation\u001f${onboardingProfileId}`)
    .digest('hex')
    .slice(0, 16);
  return `int-${digest}`;
}

function assertOnboardingProfile(profile) {
  if (!profile || !ONBOARDING_RE.test(String(profile.profileId ?? ''))) {
    throw fail('VF_INTEGRATION_ONBOARDING_PROFILE_INVALID', 'Onboarding profile is invalid');
  }
  if (!ID_RE.test(String(profile.organizationId ?? ''))) {
    throw fail('VF_INTEGRATION_ONBOARDING_PROFILE_INVALID', 'Onboarding organization is invalid');
  }
  return profile;
}

export class KairosethIntegrationProfileControlPlane {
  constructor({
    store,
    onboardingStore = null,
    resolveSecretReference = null,
    authBridge = null,
    clock = () => Date.now(),
  } = {}) {
    if (!store) throw new TypeError('store is required');
    for (const method of [
      'create',
      'get',
      'getInternal',
      'findForContext',
      'findByOnboarding',
      'list',
      'setMapping',
      'setWebhookSecretRef',
      'setAuthBinding',
      'disable',
    ]) {
      if (typeof store[method] !== 'function') throw new TypeError(`store.${method} must be a function`);
    }
    if (onboardingStore != null && typeof onboardingStore.bindIntegration !== 'function') {
      throw new TypeError('onboardingStore.bindIntegration must be a function');
    }
    if (resolveSecretReference != null && typeof resolveSecretReference !== 'function') {
      throw new TypeError('resolveSecretReference must be a function');
    }
    if (authBridge != null) {
      for (const method of ['provision', 'rotate', 'revoke']) {
        if (typeof authBridge[method] !== 'function') {
          throw new TypeError(`authBridge.${method} must be a function`);
        }
      }
    }
    if (typeof clock !== 'function') throw new TypeError('clock is required');
    this.store = store;
    this.onboardingStore = onboardingStore;
    this.resolveSecretReference = resolveSecretReference;
    this.authBridge = authBridge;
    this.clock = clock;
  }

  async ensureFromOnboarding(context, onboardingProfile) {
    const organizationId = requireOrganization(context);
    const profile = assertOnboardingProfile(onboardingProfile);
    if (profile.organizationId !== organizationId) {
      throw fail('VF_INTEGRATION_ONBOARDING_TENANT_MISMATCH', 'Onboarding profile belongs to another organization', 404);
    }

    const existing = await this.store.findByOnboarding(organizationId, profile.profileId);
    if (existing) {
      if (this.onboardingStore) {
        await this.onboardingStore.bindIntegration({
          organizationId,
          profileId: profile.profileId,
          mappingProfileId: existing.mappingProfileId,
          integrationProfileId: existing.profileId,
          now: this.clock(),
        });
      }
      return existing;
    }

    const requiresLocalAgent = Boolean(profile.strategy?.requiresLocalAgent);
    if (
      requiresLocalAgent
      && !['provisioning', 'provisioned'].includes(profile.localAgent?.status)
    ) {
      throw fail(
        'VF_INTEGRATION_LOCAL_AGENT_REQUIRED',
        'Local Agent provisioning must start before materializing this integration',
        409,
      );
    }

    const integrationProfileId = deterministicProfileId(profile.profileId);
    const installationId = requiresLocalAgent
      ? String(profile.localAgent.installationId)
      : deterministicInstallationId(profile.profileId);
    if (!ID_RE.test(installationId)) {
      throw fail('VF_INTEGRATION_INSTALLATION_INVALID', 'Derived installation id is invalid', 500);
    }

    const mappingRequired = Boolean(profile.integrationDraft?.mappingRequired);
    let created;
    try {
      created = await this.store.create({
        profileId: integrationProfileId,
        organizationId,
        installationId,
        onboardingProfileId: profile.profileId,
        channel: profile.strategy.channel,
        adapter: profile.strategy.adapter,
        sourceType: profile.integrationDraft?.sourceType ?? profile.strategy.sourceKind ?? profile.strategy.channel,
        deploymentMode: profile.strategy.deploymentMode,
        status: mappingRequired ? 'mapping-required' : 'active',
        mappingProfile: null,
        webhookSecretRef: null,
        now: this.clock(),
      });
    } catch (error) {
      if (error?.code !== 'VF_INTEGRATION_PROFILE_EXISTS') throw error;
      created = await this.store.findByOnboarding(organizationId, profile.profileId);
      if (!created) throw error;
    }

    if (this.onboardingStore) {
      await this.onboardingStore.bindIntegration({
        organizationId,
        profileId: profile.profileId,
        mappingProfileId: null,
        integrationProfileId,
        now: this.clock(),
      });
    }

    return created;
  }

  async list(context) {
    return this.store.list(requireOrganization(context));
  }

  async get(context, value) {
    const organizationId = requireOrganization(context);
    const profile = await this.store.get(organizationId, requiredProfileId(value));
    if (!profile) throw fail('VF_INTEGRATION_PROFILE_NOT_FOUND', 'Integration profile not found', 404);
    return profile;
  }

  async setMapping(context, value, input = {}) {
    const organizationId = requireOrganization(context);
    const profileId = requiredProfileId(value);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw fail('VF_INTEGRATION_MAPPING_INPUT_INVALID', 'mapping input must be an object');
    }
    for (const key of Object.keys(input)) {
      if (key !== 'mappingProfile') {
        throw fail('VF_INTEGRATION_MAPPING_INPUT_UNKNOWN', `unsupported mapping field: ${key}`);
      }
    }

    const current = await this.store.getInternal(organizationId, profileId);
    if (!current) throw fail('VF_INTEGRATION_PROFILE_NOT_FOUND', 'Integration profile not found', 404);

    const updated = await this.store.setMapping({
      organizationId,
      profileId,
      mappingProfile: input.mappingProfile,
      now: this.clock(),
    });

    if (this.onboardingStore && current.onboardingProfileId) {
      await this.onboardingStore.bindIntegration({
        organizationId,
        profileId: current.onboardingProfileId,
        mappingProfileId: profileId,
        integrationProfileId: profileId,
        now: this.clock(),
      });
    }

    return updated;
  }

  async setWebhookSecretReference(context, value, input = {}) {
    const organizationId = requireOrganization(context);
    const profileId = requiredProfileId(value);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw fail('VF_INTEGRATION_SECRET_INPUT_INVALID', 'secret reference input must be an object');
    }
    if (Object.keys(input).length !== 1 || !('webhookSecretRef' in input)) {
      throw fail(
        'VF_INTEGRATION_SECRET_INPUT_INVALID',
        'Only webhookSecretRef may be configured; raw secrets are forbidden',
      );
    }
    const ref = String(input.webhookSecretRef ?? '').trim();
    if (!ID_RE.test(ref)) {
      throw fail('VF_INTEGRATION_SECRET_REF_INVALID', 'webhookSecretRef is invalid');
    }
    return this.store.setWebhookSecretRef({
      organizationId,
      profileId,
      webhookSecretRef: ref,
      now: this.clock(),
    });
  }

  assertCredentialChannel(profile) {
    if (!AUTH_CHANNELS.has(profile?.channel)) {
      throw fail(
        'VF_INTEGRATION_CREDENTIAL_NOT_APPLICABLE',
        'This IntegrationProfile does not use Kairoseth data-plane bearer credentials',
        409,
      );
    }
  }

  assertEmptyCredentialInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 0) {
      throw fail(
        'VF_INTEGRATION_CREDENTIAL_INPUT_FORBIDDEN',
        'Credential identity is controlled by Kairoseth',
        400,
      );
    }
  }

  async provisionCredential(context, value, input = {}) {
    this.assertEmptyCredentialInput(input);
    if (!this.authBridge) {
      throw fail(
        'VF_KAIROSETH_AUTH_BRIDGE_UNAVAILABLE',
        'Kairoseth Auth bridge is unavailable',
        503,
      );
    }
    const organizationId = requireOrganization(context);
    const profileId = requiredProfileId(value);
    const profile = await this.store.getInternal(organizationId, profileId);
    if (!profile) throw fail('VF_INTEGRATION_PROFILE_NOT_FOUND', 'Integration profile not found', 404);
    this.assertCredentialChannel(profile);
    if (profile.authBinding?.status === 'active') {
      throw fail(
        'VF_INTEGRATION_CREDENTIAL_ALREADY_ACTIVE',
        'Integration credential is already active; rotate it instead',
        409,
      );
    }

    const credential = await this.authBridge.provision(profile);
    const updated = await this.store.setAuthBinding({
      organizationId,
      profileId,
      credentialId: credential.credentialId,
      status: 'active',
      now: this.clock(),
    });
    return Object.freeze({
      profile: updated,
      credential,
      credentialShownOnce: credential.shownOnce,
      tenantAuthority: 'kairoseth',
      authAuthority: 'kairoseth',
    });
  }

  async rotateCredential(context, value, input = {}) {
    this.assertEmptyCredentialInput(input);
    if (!this.authBridge) {
      throw fail(
        'VF_KAIROSETH_AUTH_BRIDGE_UNAVAILABLE',
        'Kairoseth Auth bridge is unavailable',
        503,
      );
    }
    const organizationId = requireOrganization(context);
    const profileId = requiredProfileId(value);
    const profile = await this.store.getInternal(organizationId, profileId);
    if (!profile) throw fail('VF_INTEGRATION_PROFILE_NOT_FOUND', 'Integration profile not found', 404);
    this.assertCredentialChannel(profile);
    if (profile.authBinding?.status !== 'active' || !profile.authBinding?.credentialId) {
      throw fail('VF_INTEGRATION_CREDENTIAL_NOT_ACTIVE', 'Integration credential is not active', 409);
    }

    const credential = await this.authBridge.rotate(profile, profile.authBinding.credentialId);
    const updated = await this.store.setAuthBinding({
      organizationId,
      profileId,
      credentialId: credential.credentialId,
      status: 'active',
      now: this.clock(),
    });
    return Object.freeze({
      profile: updated,
      credential,
      credentialShownOnce: credential.shownOnce,
      tenantAuthority: 'kairoseth',
      authAuthority: 'kairoseth',
    });
  }

  async revokeCredential(context, value, input = {}) {
    this.assertEmptyCredentialInput(input);
    if (!this.authBridge) {
      throw fail(
        'VF_KAIROSETH_AUTH_BRIDGE_UNAVAILABLE',
        'Kairoseth Auth bridge is unavailable',
        503,
      );
    }
    const organizationId = requireOrganization(context);
    const profileId = requiredProfileId(value);
    const profile = await this.store.getInternal(organizationId, profileId);
    if (!profile) throw fail('VF_INTEGRATION_PROFILE_NOT_FOUND', 'Integration profile not found', 404);
    this.assertCredentialChannel(profile);
    if (profile.authBinding?.status !== 'active' || !profile.authBinding?.credentialId) {
      throw fail('VF_INTEGRATION_CREDENTIAL_NOT_ACTIVE', 'Integration credential is not active', 409);
    }

    await this.authBridge.revoke(profile, profile.authBinding.credentialId);
    const updated = await this.store.setAuthBinding({
      organizationId,
      profileId,
      credentialId: profile.authBinding.credentialId,
      status: 'revoked',
      now: this.clock(),
    });
    return Object.freeze({
      profile: updated,
      revoked: true,
      tenantAuthority: 'kairoseth',
      authAuthority: 'kairoseth',
    });
  }

  async disable(context, value) {
    return this.store.disable({
      organizationId: requireOrganization(context),
      profileId: requiredProfileId(value),
      now: this.clock(),
    });
  }

  async resolveDynamicForContext(context, profileId) {
    const organizationId = String(context?.organizationId ?? '').trim();
    const installationId = String(context?.installationId ?? '').trim();
    if (!ID_RE.test(organizationId) || !ID_RE.test(installationId) || !PROFILE_RE.test(String(profileId ?? ''))) {
      return Object.freeze({ exists: false, profile: null });
    }
    const profile = await this.store.findForContext({
      organizationId,
      installationId,
      profileId,
    });
    if (!profile) return Object.freeze({ exists: false, profile: null });

    if (AUTH_CHANNELS.has(profile.channel)) {
      const binding = profile.authBinding;
      const credentialId = String(context?.credentialId ?? '');
      if (
        binding?.provider !== 'kairoseth'
        || binding?.status !== 'active'
        || !binding?.credentialId
        || binding.credentialId !== credentialId
      ) {
        return Object.freeze({
          exists: true,
          profile: Object.freeze({ ...profile, authDenied: true }),
        });
      }
    }

    return Object.freeze({
      exists: true,
      profile,
    });
  }

  async resolveMappingProfile({ context, profileId }) {
    const resolved = await this.resolveDynamicForContext(context, profileId);
    if (!resolved.exists) return Object.freeze({ exists: false, mappingProfile: null });
    if (
      resolved.profile.authDenied
      || resolved.profile.status !== 'active'
      || !resolved.profile.mappingProfile
    ) {
      return Object.freeze({ exists: true, mappingProfile: null });
    }
    return Object.freeze({
      exists: true,
      mappingProfile: structuredClone(resolved.profile.mappingProfile),
    });
  }

  async resolveWebhookSecret({ context, profileId }) {
    const resolved = await this.resolveDynamicForContext(context, profileId);
    if (!resolved.exists) return Object.freeze({ exists: false, secret: null });
    if (resolved.profile.authDenied || resolved.profile.status !== 'active') {
      return Object.freeze({ exists: true, secret: null });
    }
    const ref = resolved.profile.webhookSecretRef;
    if (!ref) return Object.freeze({ exists: true, secret: null });
    if (!this.resolveSecretReference) {
      throw fail(
        'VF_INTEGRATION_SECRET_RESOLVER_UNAVAILABLE',
        'Kairoseth secret resolver is unavailable',
        503,
      );
    }
    const secret = await this.resolveSecretReference({
      ref,
      organizationId: resolved.profile.organizationId,
      installationId: resolved.profile.installationId,
      profileId: resolved.profile.profileId,
    });
    if (typeof secret !== 'string' || secret.length < 32) {
      throw fail(
        'VF_INTEGRATION_SECRET_NOT_FOUND',
        'Kairoseth secret reference could not be resolved',
        503,
      );
    }
    return Object.freeze({ exists: true, secret });
  }
}

export function createHybridIntegrationResolvers({
  staticResolvers,
  dynamicProfiles = null,
} = {}) {
  if (!staticResolvers) throw new TypeError('staticResolvers is required');
  if (typeof staticResolvers.resolveMappingProfile !== 'function') {
    throw new TypeError('staticResolvers.resolveMappingProfile is required');
  }
  if (typeof staticResolvers.resolveWebhookSecret !== 'function') {
    throw new TypeError('staticResolvers.resolveWebhookSecret is required');
  }

  return Object.freeze({
    async resolveMappingProfile({ context, profileId }) {
      if (dynamicProfiles) {
        const dynamic = await dynamicProfiles.resolveMappingProfile({ context, profileId });
        if (dynamic.exists) return dynamic.mappingProfile;
      }
      return staticResolvers.resolveMappingProfile({ context, profileId });
    },

    async resolveWebhookSecret({ context, profileId }) {
      if (dynamicProfiles) {
        const dynamic = await dynamicProfiles.resolveWebhookSecret({ context, profileId });
        if (dynamic.exists) return dynamic.secret;
      }
      return staticResolvers.resolveWebhookSecret({ context, profileId });
    },

    resolveEuroConversion(input) {
      return staticResolvers.resolveEuroConversion(input);
    },
  });
}
