import { createHash } from 'node:crypto';

const DEFAULT_COLLECTION = 'kairoseth_local_agent_installations';
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

export function normalizeMongoRegistryCollectionName(value = DEFAULT_COLLECTION) {
  const name = String(value ?? '').trim();
  if (!COLLECTION_RE.test(name) || name.includes('..')) {
    throw new TypeError('collectionName is invalid');
  }
  return name;
}

function installationKey(organizationId, installationId) {
  return createHash('sha256')
    .update(JSON.stringify([organizationId, installationId]))
    .digest('hex');
}

function publicDocument(doc) {
  if (!doc) return null;
  return Object.freeze({
    organizationId: doc.organizationId,
    installationId: doc.installationId,
    sourceSystem: doc.sourceSystem,
    label: doc.label ?? null,
    credentialVersion: Number(doc.credentialVersion ?? 1),
    revoked: doc.revokedAt != null,
    revokedAt: doc.revokedAt == null ? null : Number(doc.revokedAt),
    createdAt: Number(doc.createdAt),
    updatedAt: Number(doc.updatedAt),
    lastSeenAt: doc.lastSeenAt == null ? null : Number(doc.lastSeenAt),
    agentVersion: doc.agentVersion ?? null,
    platform: doc.platform ?? null,
    arch: doc.arch ?? null,
    sourceKind: doc.sourceKind ?? null,
    reportedStatus: doc.reportedStatus ?? null,
    queue: doc.queue ?? null,
    desiredVersion: doc.desiredVersion ?? null,
    updatePolicy: doc.updatePolicy ?? 'manual',
  });
}

function mongoError(error, fallbackCode = 'VF_LOCAL_AGENT_REGISTRY_MONGODB_ERROR') {
  if (error?.code === 11000) {
    return fail(
      'VF_LOCAL_AGENT_INSTALLATION_EXISTS',
      'Local Agent installation already exists',
      409,
      error,
    );
  }
  return fail(fallbackCode, 'Kairoseth Local Agent registry operation failed', 500, error);
}

export function mongoLocalAgentRegistryIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ organizationId: 1, installationId: 1 }),
      name: 'local_agent_tenant_installation_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ tokenSha256: 1 }),
      name: 'local_agent_token_sha256_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ lastSeenAt: 1 }),
      name: 'local_agent_last_seen',
    }),
  ]);
}

export class MongoKairosethLocalAgentRegistryStore {
  constructor({
    database,
    collectionName = DEFAULT_COLLECTION,
  } = {}) {
    this.database = assertDatabase(database);
    this.collectionName = normalizeMongoRegistryCollectionName(collectionName);
    this.collection = this.database.collection(this.collectionName);
    if (!this.collection || typeof this.collection.findOne !== 'function') {
      throw new TypeError('Kairoseth MongoDB collection interface is invalid');
    }
  }

  indexDefinitions() {
    return mongoLocalAgentRegistryIndexes();
  }

  async get(organizationId, installationId) {
    return publicDocument(await this.collection.findOne({
      organizationId,
      installationId,
    }));
  }

  async list() {
    const docs = await this.collection
      .find({})
      .sort({ organizationId: 1, installationId: 1 })
      .toArray();
    return Object.freeze(docs.map(publicDocument));
  }

  async authByTokenSha256(tokenSha256) {
    const doc = await this.collection.findOne({
      tokenSha256,
      revokedAt: null,
    }, {
      projection: {
        _id: 0,
        organizationId: 1,
        installationId: 1,
        sourceSystem: 1,
        credentialVersion: 1,
      },
    });
    if (!doc) return null;
    return Object.freeze({
      organizationId: doc.organizationId,
      installationId: doc.installationId,
      sourceSystem: doc.sourceSystem,
      credentialVersion: Number(doc.credentialVersion),
    });
  }

  async create(record) {
    const doc = {
      _id: installationKey(record.organizationId, record.installationId),
      organizationId: record.organizationId,
      installationId: record.installationId,
      sourceSystem: record.sourceSystem,
      label: record.label,
      tokenSha256: record.tokenSha256,
      credentialVersion: 1,
      revokedAt: null,
      createdAt: record.now,
      updatedAt: record.now,
      lastSeenAt: null,
      agentVersion: null,
      platform: null,
      arch: null,
      sourceKind: null,
      reportedStatus: null,
      queue: null,
      desiredVersion: record.desiredVersion,
      updatePolicy: record.updatePolicy,
    };
    try {
      await this.collection.insertOne(doc);
      return publicDocument(doc);
    } catch (error) {
      throw mongoError(error);
    }
  }

  async rotateCredential({ organizationId, installationId, tokenSha256, now }) {
    try {
      const result = await this.collection.updateOne(
        { organizationId, installationId },
        {
          $set: {
            tokenSha256,
            revokedAt: null,
            updatedAt: now,
          },
          $inc: { credentialVersion: 1 },
        },
      );
      if (result.matchedCount !== 1) {
        throw fail('VF_LOCAL_AGENT_INSTALLATION_NOT_FOUND', 'Local Agent installation not found', 404);
      }
      return this.get(organizationId, installationId);
    } catch (error) {
      if (String(error?.code ?? '').startsWith('VF_')) throw error;
      throw mongoError(error);
    }
  }

  async revoke({ organizationId, installationId, now }) {
    try {
      const result = await this.collection.updateOne(
        { organizationId, installationId },
        { $set: { revokedAt: now, updatedAt: now } },
      );
      if (result.matchedCount !== 1) {
        throw fail('VF_LOCAL_AGENT_INSTALLATION_NOT_FOUND', 'Local Agent installation not found', 404);
      }
      return this.get(organizationId, installationId);
    } catch (error) {
      if (String(error?.code ?? '').startsWith('VF_')) throw error;
      throw mongoError(error);
    }
  }

  async setControl({
    organizationId,
    installationId,
    desiredVersion,
    updatePolicy,
    label,
    now,
  }) {
    try {
      const result = await this.collection.updateOne(
        { organizationId, installationId },
        {
          $set: {
            desiredVersion,
            updatePolicy,
            label,
            updatedAt: now,
          },
        },
      );
      if (result.matchedCount !== 1) {
        throw fail('VF_LOCAL_AGENT_INSTALLATION_NOT_FOUND', 'Local Agent installation not found', 404);
      }
      return this.get(organizationId, installationId);
    } catch (error) {
      if (String(error?.code ?? '').startsWith('VF_')) throw error;
      throw mongoError(error);
    }
  }

  async heartbeat({
    organizationId,
    installationId,
    agentVersion,
    platform,
    arch,
    sourceKind,
    reportedStatus,
    queue,
    now,
  }) {
    try {
      const result = await this.collection.updateOne(
        {
          organizationId,
          installationId,
          revokedAt: null,
        },
        {
          $set: {
            lastSeenAt: now,
            agentVersion,
            platform,
            arch,
            sourceKind,
            reportedStatus,
            queue,
            updatedAt: now,
          },
        },
      );
      if (result.matchedCount !== 1) {
        throw fail(
          'VF_LOCAL_AGENT_INSTALLATION_UNAVAILABLE',
          'Local Agent installation is unavailable',
          401,
        );
      }
      return this.get(organizationId, installationId);
    } catch (error) {
      if (String(error?.code ?? '').startsWith('VF_')) throw error;
      throw mongoError(error);
    }
  }
}

export function createMongoKairosethLocalAgentRegistryStore(options) {
  return new MongoKairosethLocalAgentRegistryStore(options);
}
