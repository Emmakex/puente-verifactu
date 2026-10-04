import { createHash } from 'node:crypto';

const DEFAULT_SESSION_COLLECTION = 'kairoseth_import_sessions';
const DEFAULT_BATCH_COLLECTION = 'kairoseth_import_batches';
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

function collectionName(value, fallback) {
  const name = String(value ?? fallback).trim();
  if (!COLLECTION_RE.test(name) || name.includes('..')) {
    throw new TypeError('collectionName is invalid');
  }
  return name;
}

function tenantQuery(context = null) {
  if (!context) return {};
  return {
    organizationId: String(context.organizationId ?? ''),
    installationId: String(context.installationId ?? ''),
  };
}

function documentId(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function assertNoBinary(value, path = 'record') {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    throw fail('VF_IMPORT_BINARY_PERSISTENCE_FORBIDDEN', `${path} must not contain file bytes`, 500);
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoBinary(item, `${path}.${index}`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    assertNoBinary(nested, `${path}.${key}`);
  }
}

export function normalizeMongoImportSessionCollectionName(value = DEFAULT_SESSION_COLLECTION) {
  return collectionName(value, DEFAULT_SESSION_COLLECTION);
}

export function normalizeMongoImportBatchCollectionName(value = DEFAULT_BATCH_COLLECTION) {
  return collectionName(value, DEFAULT_BATCH_COLLECTION);
}

export function mongoImportSessionIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ organizationId: 1, installationId: 1, importId: 1 }),
      name: 'import_session_tenant_import_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ expiresAtDate: 1 }),
      name: 'import_session_ttl',
      expireAfterSeconds: 0,
    }),
    Object.freeze({
      key: Object.freeze({ organizationId: 1, installationId: 1, createdAt: 1 }),
      name: 'import_session_tenant_created',
    }),
  ]);
}

export function mongoImportBatchIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ organizationId: 1, installationId: 1, batchId: 1 }),
      name: 'import_batch_tenant_batch_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ organizationId: 1, installationId: 1, importId: 1 }),
      name: 'import_batch_tenant_import_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ organizationId: 1, installationId: 1, status: 1, updatedAt: -1 }),
      name: 'import_batch_tenant_status_updated',
    }),
  ]);
}

export class MongoKairosethImportSessionStore {
  constructor({
    database,
    collectionName: requestedCollectionName = DEFAULT_SESSION_COLLECTION,
  } = {}) {
    this.database = assertDatabase(database);
    this.collectionName = normalizeMongoImportSessionCollectionName(requestedCollectionName);
    this.collection = this.database.collection(this.collectionName);
    if (!this.collection || typeof this.collection.findOne !== 'function') {
      throw new TypeError('Kairoseth MongoDB collection interface is invalid');
    }
  }

  indexDefinitions() {
    return mongoImportSessionIndexes();
  }

  async purgeExpired(now, context = null) {
    await this.collection.deleteMany({
      ...tenantQuery(context),
      expiresAt: { $lte: Number(now) },
    });
  }

  async ensureCapacity(maxSessions, now, context = null) {
    await this.purgeExpired(now, context);
    const query = tenantQuery(context);
    const count = await this.collection.countDocuments(query);
    const removeCount = Math.max(0, count - maxSessions + 1);
    if (removeCount === 0) return;
    const oldest = await this.collection
      .find(query, { projection: { _id: 1 } })
      .sort({ createdAt: 1, importId: 1 })
      .limit(removeCount)
      .toArray();
    if (oldest.length) {
      await this.collection.deleteMany({ _id: { $in: oldest.map((row) => row._id) } });
    }
  }

  async put(session) {
    assertNoBinary(session, 'session');
    const doc = {
      _id: documentId([session.organizationId, session.installationId, session.importId]),
      importId: session.importId,
      organizationId: session.organizationId,
      installationId: session.installationId,
      createdAt: Number(session.createdAt),
      expiresAt: Number(session.expiresAt),
      expiresAtDate: new Date(Number(session.expiresAt)),
      session: structuredClone(session),
    };
    await this.collection.replaceOne({ _id: doc._id }, doc, { upsert: true });
    return structuredClone(session);
  }

  async get(importId, context = null) {
    const doc = await this.collection.findOne({
      importId: String(importId),
      ...tenantQuery(context),
    });
    return doc ? structuredClone(doc.session) : null;
  }

  async delete(importId, context = null) {
    const result = await this.collection.deleteOne({
      importId: String(importId),
      ...tenantQuery(context),
    });
    return result.deletedCount > 0;
  }

  async size(context = null) {
    return this.collection.countDocuments(tenantQuery(context));
  }
}

export class MongoKairosethImportBatchStore {
  constructor({
    database,
    collectionName: requestedCollectionName = DEFAULT_BATCH_COLLECTION,
  } = {}) {
    this.database = assertDatabase(database);
    this.collectionName = normalizeMongoImportBatchCollectionName(requestedCollectionName);
    this.collection = this.database.collection(this.collectionName);
    if (!this.collection || typeof this.collection.findOne !== 'function') {
      throw new TypeError('Kairoseth MongoDB collection interface is invalid');
    }
  }

  indexDefinitions() {
    return mongoImportBatchIndexes();
  }

  async create(batch) {
    assertNoBinary(batch, 'batch');
    const doc = {
      ...structuredClone(batch),
      _id: documentId([batch.organizationId, batch.installationId, batch.batchId]),
    };
    try {
      await this.collection.insertOne(doc);
      const { _id, ...result } = doc;
      return structuredClone(result);
    } catch (error) {
      if (error?.code !== 11000) {
        throw fail('VF_IMPORT_BATCH_MONGODB_ERROR', 'Kairoseth import batch operation failed', 500, error);
      }
      const existing = await this.get(batch.batchId, batch);
      if (!existing) {
        throw fail('VF_IMPORT_BATCH_CONFLICT', 'Import batch already exists', 409, error);
      }
      if (existing.fingerprint !== batch.fingerprint) {
        throw fail('VF_IMPORT_BATCH_CONFLICT', 'Import batch already exists with different content', 409, error);
      }
      return existing;
    }
  }

  async get(batchId, context = null) {
    const doc = await this.collection.findOne({
      batchId: String(batchId),
      ...tenantQuery(context),
    });
    if (!doc) return null;
    const { _id, ...result } = doc;
    return structuredClone(result);
  }
}

export function createMongoKairosethImportSessionStore(options) {
  return new MongoKairosethImportSessionStore(options);
}

export function createMongoKairosethImportBatchStore(options) {
  return new MongoKairosethImportBatchStore(options);
}
