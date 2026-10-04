const SESSION_COLLECTION = 'kairoseth_import_sessions';
const BATCH_COLLECTION = 'kairoseth_import_batches';
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

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function sessionDocument(session) {
  return {
    ...clone(session),
    _id: session.importId,
    expiresAtDate: new Date(session.expiresAt),
  };
}

function publicSession(doc) {
  if (!doc) return null;
  const value = clone(doc);
  delete value._id;
  delete value.expiresAtDate;
  return value;
}

function publicBatch(doc) {
  if (!doc) return null;
  const value = clone(doc);
  delete value._id;
  return value;
}

function mongoDuplicate(error) {
  return error?.code === 11000;
}

export function mongoImportSessionIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ expiresAtDate: 1 }),
      name: 'import_session_ttl',
      expireAfterSeconds: 0,
    }),
    Object.freeze({
      key: Object.freeze({ organizationId: 1, installationId: 1, createdAt: -1 }),
      name: 'import_session_tenant_created',
    }),
  ]);
}

export function mongoImportBatchIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ organizationId: 1, installationId: 1, batchId: 1 }),
      name: 'import_batch_tenant_id_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ organizationId: 1, installationId: 1, importId: 1 }),
      name: 'import_batch_import_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ organizationId: 1, installationId: 1, state: 1, createdAt: -1 }),
      name: 'import_batch_tenant_state_created',
    }),
  ]);
}

export class MongoKairosethImportSessionStore {
  constructor({
    database,
    collectionName: configuredCollection = SESSION_COLLECTION,
  } = {}) {
    this.database = assertDatabase(database);
    this.collectionName = collectionName(configuredCollection, SESSION_COLLECTION);
    this.collection = this.database.collection(this.collectionName);
    if (!this.collection || typeof this.collection.findOne !== 'function') {
      throw new TypeError('Kairoseth MongoDB import session collection is invalid');
    }
  }

  indexDefinitions() {
    return mongoImportSessionIndexes();
  }

  async purgeExpired(now) {
    await this.collection.deleteMany({ expiresAt: { $lte: Number(now) } });
  }

  async ensureCapacity(maxSessions, now) {
    await this.purgeExpired(now);
    const count = await this.collection.countDocuments({});
    const removeCount = Math.max(0, count - Number(maxSessions) + 1);
    if (removeCount < 1) return;
    const oldest = await this.collection
      .find({}, { projection: { _id: 1 } })
      .sort({ createdAt: 1, importId: 1 })
      .limit(removeCount)
      .toArray();
    if (oldest.length > 0) {
      await this.collection.deleteMany({ _id: { $in: oldest.map((item) => item._id) } });
    }
  }

  async put(session) {
    const doc = sessionDocument(session);
    await this.collection.replaceOne(
      { _id: doc._id },
      doc,
      { upsert: true },
    );
    return publicSession(doc);
  }

  async get(importId) {
    return publicSession(await this.collection.findOne({ _id: String(importId) }));
  }

  async delete(importId) {
    return (await this.collection.deleteOne({ _id: String(importId) })).deletedCount > 0;
  }

  async size() {
    return this.collection.countDocuments({});
  }
}

export class MongoKairosethImportBatchStore {
  constructor({
    database,
    collectionName: configuredCollection = BATCH_COLLECTION,
  } = {}) {
    this.database = assertDatabase(database);
    this.collectionName = collectionName(configuredCollection, BATCH_COLLECTION);
    this.collection = this.database.collection(this.collectionName);
    if (!this.collection || typeof this.collection.findOne !== 'function') {
      throw new TypeError('Kairoseth MongoDB import batch collection is invalid');
    }
  }

  indexDefinitions() {
    return mongoImportBatchIndexes();
  }

  async create(batch) {
    const doc = {
      ...clone(batch),
      _id: batch.batchId,
    };
    try {
      await this.collection.insertOne(doc);
      return publicBatch(doc);
    } catch (error) {
      if (!mongoDuplicate(error)) throw fail(
        'VF_IMPORT_BATCH_MONGODB_ERROR',
        'Kairoseth import batch write failed',
        500,
        error,
      );
      const existing = await this.get(
        batch.organizationId,
        batch.installationId,
        batch.batchId,
      );
      if (!existing) throw fail(
        'VF_IMPORT_BATCH_MONGODB_ERROR',
        'Import batch conflict could not be resolved',
        500,
        error,
      );
      if (
        existing.importId !== batch.importId
        || existing.preflightToken !== batch.preflightToken
      ) {
        throw fail(
          'VF_IMPORT_BATCH_CONFIRM_CONFLICT',
          'Import batch already exists with a different confirmed preflight',
          409,
          error,
        );
      }
      return existing;
    }
  }

  async get(organizationId, installationId, batchId) {
    return publicBatch(await this.collection.findOne({
      organizationId: String(organizationId),
      installationId: String(installationId),
      batchId: String(batchId),
    }));
  }

  async list(organizationId, installationId, limit = 50) {
    const docs = await this.collection
      .find({
        organizationId: String(organizationId),
        installationId: String(installationId),
      })
      .sort({ createdAt: -1, batchId: 1 })
      .limit(Math.max(1, Math.min(200, Number(limit) || 50)))
      .toArray();
    return docs.map(publicBatch);
  }

  async claim({
    organizationId,
    installationId,
    batchId,
    owner,
    now,
    leaseUntil,
  }) {
    const filter = {
      organizationId: String(organizationId),
      installationId: String(installationId),
      batchId: String(batchId),
      $or: [
        { state: { $in: ['confirmed', 'partial'] } },
        { state: 'processing', 'lease.until': { $lte: Number(now) } },
      ],
    };
    const result = await this.collection.findOneAndUpdate(
      filter,
      {
        $set: {
          state: 'processing',
          lease: { owner: String(owner), until: Number(leaseUntil) },
          updatedAt: Number(now),
        },
      },
      { returnDocument: 'after' },
    );
    const doc = result?.value ?? result;
    if (doc) return publicBatch(doc);

    const current = await this.get(organizationId, installationId, batchId);
    if (!current) throw fail('VF_IMPORT_BATCH_NOT_FOUND', 'Import batch not found', 404);
    if (current.state === 'completed') return current;
    throw fail('VF_IMPORT_BATCH_BUSY', 'Import batch is already being processed', 409);
  }

  async updateRow({
    organizationId,
    installationId,
    batchId,
    row,
    patch,
    owner,
    now,
  }) {
    const allowed = new Set(['status', 'recordId', 'error', 'issuedAt']);
    const set = { updatedAt: Number(now) };
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (!allowed.has(key)) {
        throw new TypeError(`Unsupported import row patch field: ${key}`);
      }
      set[`rows.$.${key}`] = clone(value);
    }
    const result = await this.collection.updateOne(
      {
        organizationId: String(organizationId),
        installationId: String(installationId),
        batchId: String(batchId),
        'lease.owner': String(owner),
        'rows.row': Number(row),
      },
      { $set: set },
    );
    if (result.matchedCount !== 1) {
      throw fail(
        'VF_IMPORT_BATCH_LEASE_LOST',
        'Import batch row could not be updated with the active lease',
        409,
      );
    }
    return this.get(organizationId, installationId, batchId);
  }

  async finalize({
    organizationId,
    installationId,
    batchId,
    owner,
    state,
    summary,
    now,
  }) {
    if (!['completed', 'partial'].includes(state)) {
      throw new TypeError('Import batch final state must be completed or partial');
    }
    const result = await this.collection.findOneAndUpdate(
      {
        organizationId: String(organizationId),
        installationId: String(installationId),
        batchId: String(batchId),
        'lease.owner': String(owner),
      },
      {
        $set: {
          state,
          summary: clone(summary),
          lease: null,
          updatedAt: Number(now),
        },
      },
      { returnDocument: 'after' },
    );
    const doc = result?.value ?? result;
    if (!doc) {
      throw fail(
        'VF_IMPORT_BATCH_LEASE_LOST',
        'Import batch could not be finalized with the active lease',
        409,
      );
    }
    return publicBatch(doc);
  }
}

export function createMongoKairosethImportSessionStore(options) {
  return new MongoKairosethImportSessionStore(options);
}

export function createMongoKairosethImportBatchStore(options) {
  return new MongoKairosethImportBatchStore(options);
}
