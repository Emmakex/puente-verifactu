import { createHash } from 'node:crypto';

const DEFAULT_COLLECTION = 'kairoseth_onboarding_profiles';
const COLLECTION_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;

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

export function normalizeMongoOnboardingCollectionName(value = DEFAULT_COLLECTION) {
  const name = String(value ?? '').trim();
  if (!COLLECTION_RE.test(name) || name.includes('..')) {
    throw new TypeError('collectionName is invalid');
  }
  return name;
}

function documentId(organizationId, profileId) {
  return createHash('sha256')
    .update(JSON.stringify([organizationId, profileId]))
    .digest('hex');
}

function publicDocument(doc) {
  if (!doc) return null;
  return Object.freeze({
    profileId: doc.profileId,
    organizationId: doc.organizationId,
    label: doc.label ?? null,
    locale: doc.locale,
    capabilities: Object.freeze({ ...(doc.capabilities ?? {}) }),
    strategy: Object.freeze({ ...(doc.strategy ?? {}) }),
    integrationDraft: Object.freeze({
      ...(doc.integrationDraft ?? {}),
      mappingProfileId: doc.integrationDraft?.mappingProfileId ?? null,
      integrationProfileId: doc.integrationDraft?.integrationProfileId ?? null,
    }),
    localAgent: Object.freeze({
      required: Boolean(doc.localAgent?.required),
      status: doc.localAgent?.status ?? 'not-required',
      installationId: doc.localAgent?.installationId ?? null,
      lastErrorCode: doc.localAgent?.lastErrorCode ?? null,
    }),
    createdAt: Number(doc.createdAt),
    updatedAt: Number(doc.updatedAt),
    createdByCredentialId: doc.createdByCredentialId ?? null,
  });
}

function mongoError(error, fallbackCode = 'VF_ONBOARDING_PROFILE_MONGODB_ERROR') {
  if (error?.code === 11000) {
    return fail('VF_ONBOARDING_PROFILE_EXISTS', 'Onboarding profile already exists', 409, error);
  }
  return fail(fallbackCode, 'Kairoseth onboarding profile operation failed', 500, error);
}

export function mongoOnboardingProfileIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ organizationId: 1, profileId: 1 }),
      name: 'onboarding_tenant_profile_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ organizationId: 1, createdAt: -1 }),
      name: 'onboarding_tenant_created',
    }),
    Object.freeze({
      key: Object.freeze({ 'localAgent.installationId': 1 }),
      name: 'onboarding_local_agent_installation_sparse',
      unique: true,
      sparse: true,
    }),
  ]);
}

export class MongoKairosethOnboardingProfileStore {
  constructor({
    database,
    collectionName = DEFAULT_COLLECTION,
  } = {}) {
    this.database = assertDatabase(database);
    this.collectionName = normalizeMongoOnboardingCollectionName(collectionName);
    this.collection = this.database.collection(this.collectionName);
    if (!this.collection || typeof this.collection.findOne !== 'function') {
      throw new TypeError('Kairoseth MongoDB collection interface is invalid');
    }
  }

  indexDefinitions() {
    return mongoOnboardingProfileIndexes();
  }

  async create(record) {
    const doc = {
      _id: documentId(record.organizationId, record.profileId),
      profileId: record.profileId,
      organizationId: record.organizationId,
      label: record.label,
      locale: record.locale,
      capabilities: { ...record.capabilities },
      strategy: { ...record.strategy },
      integrationDraft: {
        ...record.integrationDraft,
        mappingProfileId: null,
        integrationProfileId: null,
      },
      localAgent: {
        required: Boolean(record.localAgent?.required),
        status: record.localAgent?.required ? 'not-provisioned' : 'not-required',
        installationId: null,
        lastErrorCode: null,
      },
      createdAt: record.now,
      updatedAt: record.now,
      createdByCredentialId: record.createdByCredentialId,
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
      organizationId,
      profileId,
    }));
  }

  async list(organizationId) {
    const docs = await this.collection
      .find({ organizationId })
      .sort({ createdAt: -1, profileId: 1 })
      .toArray();
    return Object.freeze(docs.map(publicDocument));
  }

  async bindIntegration({
    organizationId,
    profileId,
    mappingProfileId,
    integrationProfileId,
    now,
  }) {
    const result = await this.collection.updateOne(
      { organizationId, profileId },
      {
        $set: {
          'integrationDraft.mappingProfileId': mappingProfileId,
          'integrationDraft.integrationProfileId': integrationProfileId,
          'integrationDraft.status': 'bound',
          updatedAt: now,
        },
      },
    );
    if (result.matchedCount !== 1) {
      throw fail('VF_ONBOARDING_PROFILE_NOT_FOUND', 'Onboarding profile not found', 404);
    }
    return this.get(organizationId, profileId);
  }

  async reserveLocalAgent({
    organizationId,
    profileId,
    installationId,
    now,
  }) {
    const result = await this.collection.updateOne(
      {
        organizationId,
        profileId,
        'localAgent.required': true,
        'localAgent.status': { $in: ['not-provisioned', 'error'] },
      },
      {
        $set: {
          'localAgent.status': 'provisioning',
          'localAgent.installationId': installationId,
          'localAgent.lastErrorCode': null,
          updatedAt: now,
        },
      },
    );

    if (result.matchedCount === 1) return this.get(organizationId, profileId);

    const current = await this.get(organizationId, profileId);
    if (!current) throw fail('VF_ONBOARDING_PROFILE_NOT_FOUND', 'Onboarding profile not found', 404);
    if (!current.localAgent.required) {
      throw fail('VF_ONBOARDING_LOCAL_AGENT_NOT_REQUIRED', 'This onboarding profile does not require Local Agent', 409);
    }
    if (current.localAgent.status === 'provisioned') {
      throw fail('VF_ONBOARDING_LOCAL_AGENT_ALREADY_PROVISIONED', 'Local Agent is already provisioned', 409);
    }
    if (
      current.localAgent.status === 'provisioning'
      && current.localAgent.installationId === installationId
    ) {
      return current;
    }
    throw fail('VF_ONBOARDING_LOCAL_AGENT_STATE_CONFLICT', 'Local Agent provisioning state conflicts', 409);
  }

  async finalizeLocalAgent({
    organizationId,
    profileId,
    installationId,
    now,
  }) {
    const result = await this.collection.updateOne(
      {
        organizationId,
        profileId,
        'localAgent.required': true,
        'localAgent.status': 'provisioning',
        'localAgent.installationId': installationId,
      },
      {
        $set: {
          'localAgent.status': 'provisioned',
          'localAgent.lastErrorCode': null,
          updatedAt: now,
        },
      },
    );
    if (result.matchedCount !== 1) {
      throw fail('VF_ONBOARDING_LOCAL_AGENT_FINALIZE_CONFLICT', 'Local Agent provisioning could not be finalized', 409);
    }
    return this.get(organizationId, profileId);
  }

  async failLocalAgent({
    organizationId,
    profileId,
    installationId,
    errorCode,
    now,
  }) {
    await this.collection.updateOne(
      {
        organizationId,
        profileId,
        'localAgent.installationId': installationId,
        'localAgent.status': 'provisioning',
      },
      {
        $set: {
          'localAgent.status': 'error',
          'localAgent.lastErrorCode': String(errorCode ?? 'VF_ONBOARDING_LOCAL_AGENT_PROVISION_FAILED'),
          updatedAt: now,
        },
      },
    );
    return this.get(organizationId, profileId);
  }
}

export function createMongoKairosethOnboardingProfileStore(options) {
  return new MongoKairosethOnboardingProfileStore(options);
}
