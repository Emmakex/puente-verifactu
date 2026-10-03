import { randomUUID } from 'node:crypto';

const PROFILE_RE = /^onb_[a-f0-9]{32}$/;
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function fail(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function requireContext(context) {
  const organizationId = String(context?.organizationId ?? '').trim();
  if (!ID_RE.test(organizationId)) {
    throw fail('VF_ONBOARDING_TENANT_CONTEXT_REQUIRED', 'Kairoseth organization context is required', 403);
  }
  return organizationId;
}

function profileId() {
  return `onb_${randomUUID().replaceAll('-', '')}`;
}

function requiredProfileId(value) {
  const id = String(value ?? '').trim();
  if (!PROFILE_RE.test(id)) throw fail('VF_ONBOARDING_PROFILE_ID_INVALID', 'Onboarding profile id is invalid');
  return id;
}

function optionalLabel(value) {
  if (value == null || value === '') return null;
  const label = String(value).trim();
  if (!label || label.length > 160) throw fail('VF_ONBOARDING_PROFILE_INPUT_INVALID', 'label is invalid');
  return label;
}

function optionalReference(value, name) {
  if (value == null || value === '') return null;
  const id = String(value).trim();
  if (!ID_RE.test(id)) throw fail('VF_ONBOARDING_PROFILE_INPUT_INVALID', `${name} is invalid`);
  return id;
}

function cleanCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail('VF_ONBOARDING_PROFILE_INPUT_INVALID', 'capabilities must be an object');
  }
  return Object.freeze({ ...value });
}

function integrationDraft(strategy) {
  return Object.freeze({
    schemaVersion: 1,
    status: 'pending',
    mappingProfileId: null,
    integrationProfileId: null,
    mappingRequired: strategy.channel !== 'manual',
    sourceType: strategy.sourceKind ?? strategy.channel,
    channel: strategy.channel,
    adapter: strategy.adapter,
    deploymentMode: strategy.deploymentMode,
    tenantBound: true,
    fiscalAuthority: 'kairoseth',
  });
}

function deterministicInstallationId(profile) {
  return `onb-${profile.profileId.slice(4, 20)}`;
}

export class KairosethOnboardingControlPlane {
  constructor({
    store,
    localAgents,
    resolveStrategy,
    integrationProfiles = null,
    clock = () => Date.now(),
  } = {}) {
    if (!store) throw new TypeError('store is required');
    for (const method of [
      'create',
      'get',
      'list',
      'bindIntegration',
      'reserveLocalAgent',
      'finalizeLocalAgent',
      'failLocalAgent',
    ]) {
      if (typeof store[method] !== 'function') throw new TypeError(`store.${method} must be a function`);
    }
    if (!localAgents) throw new TypeError('localAgents is required');
    for (const method of ['get', 'provision', 'rotateCredential']) {
      if (typeof localAgents[method] !== 'function') {
        throw new TypeError(`localAgents.${method} must be a function`);
      }
    }
    if (typeof resolveStrategy !== 'function') throw new TypeError('resolveStrategy is required');
    if (integrationProfiles != null && typeof integrationProfiles.ensureFromOnboarding !== 'function') {
      throw new TypeError('integrationProfiles.ensureFromOnboarding must be a function');
    }
    if (typeof clock !== 'function') throw new TypeError('clock is required');
    this.store = store;
    this.localAgents = localAgents;
    this.resolveStrategy = resolveStrategy;
    this.integrationProfiles = integrationProfiles;
    this.clock = clock;
  }

  async createProfile(context, input = {}) {
    const organizationId = requireContext(context);
    for (const key of Object.keys(input ?? {})) {
      if (!['label', 'capabilities'].includes(key)) {
        throw fail('VF_ONBOARDING_PROFILE_INPUT_UNKNOWN', `unsupported onboarding profile field: ${key}`);
      }
    }

    const capabilities = cleanCapabilities(input.capabilities);
    const strategy = await this.resolveStrategy(capabilities);
    const now = this.clock();
    return this.store.create({
      profileId: profileId(),
      organizationId,
      label: optionalLabel(input.label),
      locale: strategy.locale,
      capabilities,
      strategy,
      integrationDraft: integrationDraft(strategy),
      localAgent: { required: strategy.requiresLocalAgent },
      createdByCredentialId: String(context?.credentialId ?? '') || null,
      now,
    });
  }

  async listProfiles(context) {
    return this.store.list(requireContext(context));
  }

  async getProfile(context, value) {
    const organizationId = requireContext(context);
    const profile = await this.store.get(organizationId, requiredProfileId(value));
    if (!profile) throw fail('VF_ONBOARDING_PROFILE_NOT_FOUND', 'Onboarding profile not found', 404);
    return profile;
  }

  async bindIntegration(context, value, input = {}) {
    const organizationId = requireContext(context);
    const id = requiredProfileId(value);
    const mappingProfileId = optionalReference(input.mappingProfileId, 'mappingProfileId');
    const integrationProfileId = optionalReference(input.integrationProfileId, 'integrationProfileId');
    if (!mappingProfileId && !integrationProfileId) {
      throw fail('VF_ONBOARDING_PROFILE_INPUT_INVALID', 'mappingProfileId or integrationProfileId is required');
    }
    for (const key of Object.keys(input ?? {})) {
      if (!['mappingProfileId', 'integrationProfileId'].includes(key)) {
        throw fail('VF_ONBOARDING_PROFILE_INPUT_UNKNOWN', `unsupported integration binding field: ${key}`);
      }
    }

    const current = await this.store.get(organizationId, id);
    if (!current) throw fail('VF_ONBOARDING_PROFILE_NOT_FOUND', 'Onboarding profile not found', 404);
    return this.store.bindIntegration({
      organizationId,
      profileId: id,
      mappingProfileId: mappingProfileId ?? current.integrationDraft.mappingProfileId,
      integrationProfileId: integrationProfileId ?? current.integrationDraft.integrationProfileId,
      now: this.clock(),
    });
  }

  async materializeIntegration(context, value, input = {}) {
    if (!this.integrationProfiles) {
      throw fail(
        'VF_INTEGRATION_PROFILE_STORE_UNAVAILABLE',
        'Kairoseth integration profile store is unavailable',
        503,
      );
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 0) {
      throw fail(
        'VF_INTEGRATION_MATERIALIZE_INPUT_FORBIDDEN',
        'Integration identity is generated by Kairoseth from the onboarding profile',
      );
    }
    const profile = await this.getProfile(context, value);
    const integration = await this.integrationProfiles.ensureFromOnboarding(context, profile);
    const updatedProfile = await this.store.bindIntegration({
      organizationId: profile.organizationId,
      profileId: profile.profileId,
      mappingProfileId: profile.integrationDraft.mappingProfileId,
      integrationProfileId: integration.profileId,
      now: this.clock(),
    });
    return Object.freeze({
      profile: updatedProfile,
      integration,
      tenantAuthority: 'kairoseth',
      fiscalAuthority: 'kairoseth',
    });
  }

  async provisionLocalAgent(context, value, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw fail('VF_ONBOARDING_PROFILE_INPUT_INVALID', 'provisioning input must be an object');
    }
    if (Object.keys(input).length > 0) {
      throw fail(
        'VF_ONBOARDING_PROVISIONING_INPUT_FORBIDDEN',
        'Local Agent identity is generated by Kairoseth from the onboarding profile',
      );
    }
    const organizationId = requireContext(context);
    const id = requiredProfileId(value);
    const current = await this.store.get(organizationId, id);
    if (!current) throw fail('VF_ONBOARDING_PROFILE_NOT_FOUND', 'Onboarding profile not found', 404);
    if (!current.localAgent.required) {
      throw fail('VF_ONBOARDING_LOCAL_AGENT_NOT_REQUIRED', 'This onboarding profile does not require Local Agent', 409);
    }
    if (current.localAgent.status === 'provisioned') {
      throw fail('VF_ONBOARDING_LOCAL_AGENT_ALREADY_PROVISIONED', 'Local Agent is already provisioned', 409);
    }

    const installationId = current.localAgent.installationId ?? deterministicInstallationId(current);
    const reservedProfile = await this.store.reserveLocalAgent({
      organizationId,
      profileId: id,
      installationId,
      now: this.clock(),
    });

    let provisioned;
    let integration = null;
    try {
      if (this.integrationProfiles) {
        integration = await this.integrationProfiles.ensureFromOnboarding(context, reservedProfile);
      }
      const existing = await this.localAgents.get(organizationId, installationId);
      provisioned = existing
        ? await this.localAgents.rotateCredential({ organizationId, installationId })
        : await this.localAgents.provision({
            organizationId,
            installationId,
            sourceSystem: 'local-agent',
            label: current.label ?? `Onboarding ${id}`,
            updatePolicy: 'manual',
          });
    } catch (error) {
      await this.store.failLocalAgent({
        organizationId,
        profileId: id,
        installationId,
        errorCode: error?.code,
        now: this.clock(),
      });
      throw error;
    }

    const profile = await this.store.finalizeLocalAgent({
      organizationId,
      profileId: id,
      installationId,
      now: this.clock(),
    });

    return Object.freeze({
      profile,
      integration,
      installation: provisioned.installation,
      credential: provisioned.credential,
      credentialShownOnce: true,
      tenantAuthority: 'kairoseth',
      fiscalAuthority: 'kairoseth',
    });
  }
}
