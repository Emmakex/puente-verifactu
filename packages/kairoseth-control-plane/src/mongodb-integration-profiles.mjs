import { createHash } from 'node:crypto';
import { validateMappingProfile } from '../../core/src/mapping.mjs';

const DEFAULT_COLLECTION = 'kairoseth_integration_profiles';
const COLLECTION_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;
const PROFILE_RE = /^int_[a-f0-9]{32}$/;
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const STATUSES = new Set(['mapping-required', 'active', 'disabled']);
const FORBIDDEN_CONSTANT_KEYS = new Set([
  'organizationId',
  'installationId',
  'sourceSystem',
  'certificate',
  'certificatePath',
  'privateKey',
  'pfx',
  'aeat',
  'aeatEnvironment',
  'fiscalRules',
  'taxRules',
]);

function fail(code, message, status = 500, cause = null) {
  return Object.assign(new Error(message), {
    code,
    status,
    ...(cause ? { cause } : {}),
  });
}

function assertDatabase(database) {
  if (!database || typeof database.collection !== 'function') {
    throw new TypeError('Kairoseth MongoDB database with collection() is required');
  }
  return database;
}

export function normalizeMongoIntegrationCollectionName(value = DEFAULT_COLLECTION) {
  const name = String(value ?? '').trim();
  if (!COLLECTION_RE.test(name) || name.includes('..')) {
    throw new TypeError('collectionName is invalid');
  }
  return name;
}

function requiredId(value, name, pattern = ID_RE) {
  const text = String(value ?? '').trim();
  if (!pattern.test(text)) throw fail('VF_INTEGRATION_PROFILE_INPUT_INVALID', `${name} is invalid`, 400);
  return text;
}

function documentId(organizationId, profileId) {
  return createHash('sha256')
    .update(JSON.stringify([organizationId, profileId]))
    .digest('hex');
}

function assertNoForbiddenAuthority(value, path = 'constants') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenAuthority(item, `${path}.${index}`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_CONSTANT_KEYS.has(key)) {
      throw fail(
        'VF_INTEGRATION_MAPPING_AUTHORITY_FORBIDDEN',
        `MappingProfile.${path}.${key} is controlled by Kairoseth`,
        400,
      );
    }
    assertNoForbiddenAuthority(nested, `${path}.${key}`);
  }
}

function sanitizeMappingProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw fail('VF_INTEGRATION_MAPPING_REQUIRED', 'mappingProfile is required', 400);
  }

  const validation = validateMappingProfile(profile);
  if (!validation.ok) {
    throw fail(
      'VF_INTEGRATION_MAPPING_INVALID',
      `MappingProfile invalid: ${validation.errors.join('; ')}`,
      400,
    );
  }

  assertNoForbiddenAuthority(profile.constants ?? {});
  return structuredClone(profile);
}

function publicDocument(doc) {
  if (!doc) return null;
  return Object.freeze({
    profileId: doc.profileId,
    organizationId: doc.organizationId,
    installationId: doc.installationId,
    onboardingProfileId: doc.onboardingProfileId ?? null,
    channel: doc.channel,
    adapter: doc.adapter,
    sourceType: doc.sourceType,
    deploymentMode: doc.deploymentMode,
    status: doc.status,
    mappingProfile: doc.mappingProfile == null
      ? null
      : Object.freeze(structuredClone(doc.mappingProfile)),
    mappingProfileId: doc.mappingProfile?.id ?? null,
    webhookSecretConfigured: Boolean(doc.webhookSecretRef),
    authBinding: Object.freeze({
      provider: doc.authBinding?.provider ?? 'kairoseth',
      status: doc.authBinding?.status ?? 'unbound',
      credentialId: doc.authBinding?.credentialId ?? null,
    }),
    createdAt: Number(doc.createdAt),
    updatedAt: Number(doc.updatedAt),
  });
}

function mongoError(error, fallbackCode = 'VF_INTEGRATION_PROFILE_MONGODB_ERROR') {
  if (error?.code === 11000) {
    return fail('VF_INTEGRATION_PROFILE_EXISTS', 'Integration profile already exists', 409, error);
  }
  return fail(fallbackCode, 'Kairoseth integration profile operation failed', 500, error);
}

export function mongoIntegrationProfileIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ organizationId: 1, profileId: 1 }),
      name: 'integration_tenant_profile_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ organizationId: 1, installationId: 1, profileId: 1 }),
      name: 'integration_tenant_installation_profile_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ organizationId: 1, status: 1, updatedAt: -1 }),
      name: 'integration_tenant_status_updated',
    }),
    Object.freeze({
      key: Object.freeze({ organizationId: 1, onboardingProfileId: 1 }),
      name: 'integration_onboarding_unique',
      unique: true,
      partialFilterExpression: Object.freeze({
        onboardingProfileId: Object.freeze({ $type: 'string' }),
      }),
    }),
  ]);
}

export class MongoKairosethIntegrationProfileStore {
  constructor({
    database,
    collectionName = DEFAULT_COLLECTION,
  } = {}) {
    this.database = assertDatabase(database);
    this.collectionName = normalizeMongoIntegrationCollectionName(collectionName);
    this.collection = this.database.collection(this.collectionName);
    if (!this.collection || typeof this.collection.findOne !== 'function') {
      throw new TypeError('Kairoseth MongoDB collection interface is invalid');
    }
  }

  indexDefinitions() {
    return mongoIntegrationProfileIndexes();
  }

  async create(record) {
    const profileId = requiredId(record.profileId, 'profileId', PROFILE_RE);
    const organizationId = requiredId(record.organizationId, 'organizationId');
    const installationId = requiredId(record.installationId, 'installationId');
    const status = String(record.status ?? 'mapping-required');
    if (!STATUSES.has(status)) {
      throw fail('VF_INTEGRATION_PROFILE_INPUT_INVALID', 'status is invalid', 400);
    }

    const doc = {
      _id: documentId(organizationId, profileId),
      profileId,
      organizationId,
      installationId,
      onboardingProfileId: record.onboardingProfileId == null
        ? null
        : requiredId(record.onboardingProfileId, 'onboardingProfileId'),
      channel: requiredId(record.channel, 'channel'),
      adapter: requiredId(record.adapter, 'adapter'),
      sourceType: requiredId(record.sourceType, 'sourceType'),
      deploymentMode: requiredId(record.deploymentMode, 'deploymentMode'),
      status,
      mappingProfile: record.mappingProfile == null
        ? null
        : sanitizeMappingProfile(record.mappingProfile),
      webhookSecretRef: record.webhookSecretRef == null
        ? null
        : requiredId(record.webhookSecretRef, 'webhookSecretRef'),
      authBinding: {
        provider: 'kairoseth',
        status: 'unbound',
        credentialId: null,
      },
      createdAt: record.now,
      updatedAt: record.now,
    };

    try {
      await this.collection.insertOne(doc);
      return publicDocument(doc);
    } catch (error) {
      throw mongoError(error);
    }
  }

  async get(organizationId, profileId) {
    return publicDocument(await this.collection.findOne({
      organizationId: requiredId(organizationId, 'organizationId'),
      profileId: requiredId(profileId, 'profileId', PROFILE_RE),
    }));
  }

  async getInternal(organizationId, profileId) {
    const doc = await this.collection.findOne({
      organizationId: requiredId(organizationId, 'organizationId'),
      profileId: requiredId(profileId, 'profileId', PROFILE_RE),
    });
    return doc ? structuredClone(doc) : null;
  }

  async findByOnboarding(organizationId, onboardingProfileId) {
    const doc = await this.collection.findOne({
      organizationId: requiredId(organizationId, 'organizationId'),
      onboardingProfileId: requiredId(onboardingProfileId, 'onboardingProfileId'),
    });
    return doc ? publicDocument(doc) : null;
  }

  async findForContext({ organizationId, installationId, profileId }) {
    const doc = await this.collection.findOne({
      organizationId: requiredId(organizationId, 'organizationId'),
      installationId: requiredId(installationId, 'installationId'),
      profileId: requiredId(profileId, 'profileId', PROFILE_RE),
    });
    return doc ? structuredClone(doc) : null;
  }

  async list(organizationId) {
    const docs = await this.collection
      .find({ organizationId: requiredId(organizationId, 'organizationId') })
      .sort({ updatedAt: -1, profileId: 1 })
      .toArray();
    return Object.freeze(docs.map(publicDocument));
  }

  async setMapping({
    organizationId,
    profileId,
    mappingProfile,
    now,
  }) {
    const normalized = sanitizeMappingProfile(mappingProfile);
    const id = requiredId(profileId, 'profileId', PROFILE_RE);
    if (normalized.id !== id) {
      throw fail(
        'VF_INTEGRATION_MAPPING_ID_MISMATCH',
        'MappingProfile.id must equal IntegrationProfile.profileId',
        400,
      );
    }

    const result = await this.collection.updateOne(
      {
        organizationId: requiredId(organizationId, 'organizationId'),
        profileId: id,
        status: { $ne: 'disabled' },
      },
      {
        $set: {
          mappingProfile: normalized,
          status: 'active',
          updatedAt: now,
        },
      },
    );
    if (result.matchedCount !== 1) {
      throw fail('VF_INTEGRATION_PROFILE_NOT_FOUND', 'Integration profile not found or disabled', 404);
    }
    return this.get(organizationId, id);
  }

  async setWebhookSecretRef({
    organizationId,
    profileId,
    webhookSecretRef,
    now,
  }) {
    const result = await this.collection.updateOne(
      {
        organizationId: requiredId(organizationId, 'organizationId'),
        profileId: requiredId(profileId, 'profileId', PROFILE_RE),
        status: { $ne: 'disabled' },
      },
      {
        $set: {
          webhookSecretRef: requiredId(webhookSecretRef, 'webhookSecretRef'),
          updatedAt: now,
        },
      },
    );
    if (result.matchedCount !== 1) {
      throw fail('VF_INTEGRATION_PROFILE_NOT_FOUND', 'Integration profile not found or disabled', 404);
    }
    return this.get(organizationId, profileId);
  }

  async setAuthBinding({
    organizationId,
    profileId,
    credentialId,
    status,
    now,
  }) {
    const normalizedStatus = String(status ?? '');
    if (!['active', 'revoked'].includes(normalizedStatus)) {
      throw fail('VF_INTEGRATION_AUTH_BINDING_INVALID', 'auth binding status is invalid', 400);
    }
    const result = await this.collection.updateOne(
      {
        organizationId: requiredId(organizationId, 'organizationId'),
        profileId: requiredId(profileId, 'profileId', PROFILE_RE),
      },
      {
        $set: {
          authBinding: {
            provider: 'kairoseth',
            status: normalizedStatus,
            credentialId: requiredId(credentialId, 'credentialId'),
          },
          updatedAt: now,
        },
      },
    );
    if (result.matchedCount !== 1) {
      throw fail('VF_INTEGRATION_PROFILE_NOT_FOUND', 'Integration profile not found', 404);
    }
    return this.get(organizationId, profileId);
  }

  async disable({
    organizationId,
    profileId,
    now,
  }) {
    const result = await this.collection.updateOne(
      {
        organizationId: requiredId(organizationId, 'organizationId'),
        profileId: requiredId(profileId, 'profileId', PROFILE_RE),
      },
      {
        $set: {
          status: 'disabled',
          updatedAt: now,
        },
      },
    );
    if (result.matchedCount !== 1) {
      throw fail('VF_INTEGRATION_PROFILE_NOT_FOUND', 'Integration profile not found', 404);
    }
    return this.get(organizationId, profileId);
  }
}

export function createMongoKairosethIntegrationProfileStore(options) {
  return new MongoKairosethIntegrationProfileStore(options);
}
