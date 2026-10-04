import { createHash, randomUUID } from 'node:crypto';
import { assertFiscalAppend } from '../../core/src/fiscal-record-store.mjs';
import { sha256, stableStringify } from '../../core/src/idempotency.mjs';

const DEFAULT_FISCAL_RECORDS = 'kairoseth_fiscal_records';
const DEFAULT_FISCAL_LOCKS = 'kairoseth_fiscal_chain_locks';
const DEFAULT_API_RECORDS = 'kairoseth_api_records';
const DEFAULT_API_REQUESTS = 'kairoseth_api_requests';
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

function immutableClone(value) {
  return value == null ? value : Object.freeze(structuredClone(value));
}

function integrationFingerprint(value) {
  return sha256(stableStringify(value));
}

function operationConflict() {
  return fail(
    'VF_FISCAL_IDEMPOTENCY_CONFLICT',
    'Same fiscal operation identity received with different fiscal content',
    409,
  );
}

function apiIdempotencyConflict() {
  return fail(
    'VF_API_IDEMPOTENCY_CONFLICT',
    'Idempotency-Key was already used with different content',
    409,
  );
}

function duplicateKey(error) {
  return Number(error?.code) === 11000;
}

function deterministicDocumentId(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function mongoFiscalRecordIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ chainKey: 1, sequence: 1 }),
      name: 'fiscal_record_chain_sequence_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ operationKey: 1 }),
      name: 'fiscal_record_operation_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ chainKey: 1, createdAt: 1 }),
      name: 'fiscal_record_chain_created',
    }),
  ]);
}

export function mongoIntegrationRecordIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ organizationId: 1, installationId: 1, createdAt: -1 }),
      name: 'api_record_tenant_created',
    }),
  ]);
}

export function mongoIntegrationRequestIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ updatedAt: -1 }),
      name: 'api_request_updated',
    }),
    Object.freeze({
      key: Object.freeze({ recordId: 1 }),
      name: 'api_request_record',
      sparse: true,
    }),
  ]);
}

export class MongoKairosethFiscalRecordStore {
  constructor({
    database,
    recordsCollectionName = DEFAULT_FISCAL_RECORDS,
    locksCollectionName = DEFAULT_FISCAL_LOCKS,
    leaseMs = 30_000,
    leaseAttempts = 80,
    leaseDelayMs = 25,
    clock = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    this.database = assertDatabase(database);
    this.recordsCollectionName = collectionName(recordsCollectionName, DEFAULT_FISCAL_RECORDS);
    this.locksCollectionName = collectionName(locksCollectionName, DEFAULT_FISCAL_LOCKS);
    this.records = this.database.collection(this.recordsCollectionName);
    this.locks = this.database.collection(this.locksCollectionName);
    if (!(leaseMs > 0) || !Number.isInteger(leaseAttempts) || leaseAttempts < 1 || !(leaseDelayMs >= 0)) {
      throw new TypeError('Mongo fiscal lease settings are invalid');
    }
    this.leaseMs = leaseMs;
    this.leaseAttempts = leaseAttempts;
    this.leaseDelayMs = leaseDelayMs;
    this.clock = clock;
    this.sleep = sleep;
  }

  indexDefinitions() {
    return mongoFiscalRecordIndexes();
  }

  async operation(operationKey) {
    const doc = await this.records.findOne({ operationKey: String(operationKey) });
    if (!doc) return null;
    return {
      record: structuredClone(doc.record),
      fingerprint: doc.fingerprint,
    };
  }

  async last(chainKey) {
    const doc = await this.records.findOne(
      { chainKey: String(chainKey) },
      { sort: { sequence: -1 } },
    );
    return doc ? structuredClone(doc.record) : null;
  }

  async list(chainKey) {
    const docs = await this.records
      .find({ chainKey: String(chainKey) })
      .sort({ sequence: 1 })
      .toArray();
    return docs.map((doc) => structuredClone(doc.record));
  }

  async acquireLease(chainKey) {
    const token = `flease_${randomUUID().replaceAll('-', '')}`;
    for (let attempt = 1; attempt <= this.leaseAttempts; attempt += 1) {
      const now = this.clock();
      try {
        const doc = await this.locks.findOneAndUpdate(
          {
            _id: String(chainKey),
            $or: [
              { lease: null },
              { lease: { $exists: false } },
              { 'lease.expiresAt': { $lte: now } },
            ],
          },
          {
            $set: {
              lease: { token, expiresAt: now + this.leaseMs },
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          { upsert: true, returnDocument: 'after' },
        );
        if (doc?.lease?.token === token) return token;
      } catch (error) {
        if (!duplicateKey(error)) throw error;
      }
      if (attempt < this.leaseAttempts) await this.sleep(this.leaseDelayMs);
    }
    throw fail(
      'VF_CHAIN_CONCURRENCY_CONFLICT',
      'Fiscal chain is busy with another writer',
      409,
    );
  }

  async releaseLease(chainKey, token) {
    await this.locks.updateOne(
      { _id: String(chainKey), 'lease.token': String(token) },
      {
        $set: {
          lease: null,
          updatedAt: this.clock(),
        },
      },
    );
  }

  async executeOperation({
    chainKey,
    operationKey,
    fingerprint,
    createRecord,
  }) {
    if (typeof createRecord !== 'function') {
      throw new TypeError('createRecord callback is required');
    }

    const beforeLease = await this.operation(operationKey);
    if (beforeLease) {
      if (beforeLease.fingerprint !== fingerprint) throw operationConflict();
      return { record: beforeLease.record, duplicate: true };
    }

    const token = await this.acquireLease(chainKey);
    try {
      const existing = await this.operation(operationKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw operationConflict();
        return { record: existing.record, duplicate: true };
      }

      const previous = await this.last(chainKey);
      const record = createRecord(previous);
      const expectedSequence = previous ? previous.sequence + 1 : 1;
      assertFiscalAppend(previous, record, expectedSequence);

      const doc = {
        _id: deterministicDocumentId([chainKey, record.sequence, operationKey]),
        chainKey: String(chainKey),
        sequence: Number(record.sequence),
        operationKey: String(operationKey),
        fingerprint: String(fingerprint),
        record: structuredClone(record),
        createdAt: this.clock(),
      };
      try {
        await this.records.insertOne(doc);
      } catch (error) {
        if (!duplicateKey(error)) throw error;
        const raced = await this.operation(operationKey);
        if (raced) {
          if (raced.fingerprint !== fingerprint) throw operationConflict();
          return { record: raced.record, duplicate: true };
        }
        throw fail(
          'VF_CHAIN_CONCURRENCY_CONFLICT',
          'Fiscal chain write conflicted with another writer',
          409,
          error,
        );
      }
      return { record: structuredClone(record), duplicate: false };
    } finally {
      await this.releaseLease(chainKey, token).catch(() => {});
    }
  }
}

export class MongoKairosethIntegrationStore {
  constructor({
    database,
    recordsCollectionName = DEFAULT_API_RECORDS,
    requestsCollectionName = DEFAULT_API_REQUESTS,
    reservationLeaseMs = 60_000,
    clock = () => Date.now(),
  } = {}) {
    this.database = assertDatabase(database);
    this.recordsCollectionName = collectionName(recordsCollectionName, DEFAULT_API_RECORDS);
    this.requestsCollectionName = collectionName(requestsCollectionName, DEFAULT_API_REQUESTS);
    this.records = this.database.collection(this.recordsCollectionName);
    this.requests = this.database.collection(this.requestsCollectionName);
    if (!(reservationLeaseMs > 0)) throw new TypeError('reservationLeaseMs must be positive');
    this.reservationLeaseMs = reservationLeaseMs;
    this.clock = clock;
  }

  recordIndexDefinitions() {
    return mongoIntegrationRecordIndexes();
  }

  requestIndexDefinitions() {
    return mongoIntegrationRequestIndexes();
  }

  async get(recordId) {
    const doc = await this.records.findOne({ _id: String(recordId) });
    return doc ? immutableClone(doc.record) : null;
  }

  async put(record) {
    const doc = {
      _id: String(record.recordId),
      organizationId: String(record.organizationId),
      installationId: String(record.installationId),
      record: structuredClone(record),
      createdAt: this.clock(),
    };
    try {
      await this.records.insertOne(doc);
      return immutableClone(record);
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      const existing = await this.get(record.recordId);
      if (!existing || stableStringify(existing) !== stableStringify(record)) {
        throw fail(
          'VF_API_RECORD_CONFLICT',
          'Record id already exists with different content',
          409,
          error,
        );
      }
      return existing;
    }
  }

  async reserve(key, payload) {
    const requestKey = String(key);
    const fingerprint = integrationFingerprint(payload);
    const token = `ireq_${randomUUID().replaceAll('-', '')}`;
    const now = this.clock();

    try {
      await this.requests.insertOne({
        _id: requestKey,
        fingerprint,
        recordId: null,
        lease: { token, expiresAt: now + this.reservationLeaseMs },
        createdAt: now,
        updatedAt: now,
      });
      return {
        existing: { fingerprint, recordId: null },
        duplicate: false,
        reservationToken: token,
      };
    } catch (error) {
      if (!duplicateKey(error)) throw error;
    }

    let existing = await this.requests.findOne({ _id: requestKey });
    if (!existing) {
      throw fail(
        'VF_API_IDEMPOTENCY_STORE_ERROR',
        'Idempotency reservation was not persisted',
      );
    }
    if (existing.fingerprint !== fingerprint) throw apiIdempotencyConflict();
    if (existing.recordId) {
      return {
        existing: { fingerprint, recordId: existing.recordId },
        duplicate: true,
        reservationToken: null,
      };
    }
    if (Number(existing.lease?.expiresAt ?? 0) > now) {
      return {
        existing: { fingerprint, recordId: null },
        duplicate: true,
        reservationToken: null,
      };
    }

    const reclaimed = await this.requests.findOneAndUpdate(
      {
        _id: requestKey,
        fingerprint,
        recordId: null,
        $or: [
          { lease: null },
          { lease: { $exists: false } },
          { 'lease.expiresAt': { $lte: now } },
        ],
      },
      {
        $set: {
          lease: { token, expiresAt: now + this.reservationLeaseMs },
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );
    if (reclaimed?.lease?.token === token) {
      return {
        existing: { fingerprint, recordId: null },
        duplicate: false,
        reservationToken: token,
      };
    }

    existing = await this.requests.findOne({ _id: requestKey });
    if (!existing) throw fail('VF_API_IDEMPOTENCY_STORE_ERROR', 'Idempotency reservation disappeared');
    if (existing.fingerprint !== fingerprint) throw apiIdempotencyConflict();
    return {
      existing: { fingerprint, recordId: existing.recordId ?? null },
      duplicate: true,
      reservationToken: null,
    };
  }

  async complete(key, payload, recordId, reservationToken = null) {
    const fingerprint = integrationFingerprint(payload);
    const result = await this.requests.updateOne(
      {
        _id: String(key),
        fingerprint,
        recordId: null,
        ...(reservationToken
          ? { 'lease.token': String(reservationToken) }
          : {}),
      },
      {
        $set: {
          recordId: String(recordId),
          lease: null,
          updatedAt: this.clock(),
        },
      },
    );
    if (result.matchedCount !== 1) {
      const existing = await this.requests.findOne({ _id: String(key) });
      if (
        existing?.fingerprint === fingerprint
        && existing?.recordId === String(recordId)
      ) return;
      throw fail(
        'VF_API_IDEMPOTENCY_STORE_ERROR',
        'Idempotency reservation could not be completed',
      );
    }
  }

  async release(key, payload, reservationToken = null) {
    const fingerprint = integrationFingerprint(payload);
    await this.requests.deleteOne({
      _id: String(key),
      fingerprint,
      recordId: null,
      ...(reservationToken
        ? { 'lease.token': String(reservationToken) }
        : {}),
    });
  }
}

export function createMongoKairosethFiscalRecordStore(options) {
  return new MongoKairosethFiscalRecordStore(options);
}

export function createMongoKairosethIntegrationStore(options) {
  return new MongoKairosethIntegrationStore(options);
}
