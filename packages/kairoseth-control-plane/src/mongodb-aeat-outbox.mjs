import { randomUUID } from 'node:crypto';
import { stableStringify } from '../../core/src/idempotency.mjs';

const DEFAULT_COLLECTION = 'kairoseth_aeat_outbox';
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

function collectionName(value, fallback = DEFAULT_COLLECTION) {
  const name = String(value ?? fallback).trim();
  if (!COLLECTION_RE.test(name) || name.includes('..')) {
    throw new TypeError('collectionName is invalid');
  }
  return name;
}

function immutableJob(job) {
  if (!job) return null;
  const { _id, ...value } = job;
  return Object.freeze(structuredClone({
    id: value.id,
    payload: value.payload,
    state: value.state,
    attempts: Number(value.attempts ?? 0),
    availableAt: Number(value.availableAt),
    lastResult: value.lastResult ?? null,
    leaseOwner: value.leaseOwner ?? null,
    leaseUntil: value.leaseUntil == null ? null : Number(value.leaseUntil),
    createdAt: Number(value.createdAt),
    updatedAt: Number(value.updatedAt),
  }));
}

function reconciliationResult(reason) {
  return {
    kind: 'reconciliation_required',
    status: 'unknown',
    retryable: false,
    reason,
  };
}

export function mongoAeatOutboxIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ state: 1, availableAt: 1, id: 1 }),
      name: 'aeat_outbox_due',
    }),
    Object.freeze({
      key: Object.freeze({ state: 1, leaseUntil: 1 }),
      name: 'aeat_outbox_lease',
    }),
  ]);
}

export class MongoKairosethAeatOutboxStore {
  constructor({
    database,
    collectionName: requestedCollectionName = DEFAULT_COLLECTION,
  } = {}) {
    this.database = assertDatabase(database);
    this.collectionName = collectionName(requestedCollectionName);
    this.collection = this.database.collection(this.collectionName);
  }

  indexDefinitions() {
    return mongoAeatOutboxIndexes();
  }

  async healthcheck() {
    try {
      await this.collection.findOne({}, { projection: { _id: 1 } });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  async enqueue(payload, {
    availableAt = Date.now(),
    id = `aeat_${randomUUID()}`,
    now = Date.now(),
  } = {}) {
    const doc = {
      _id: String(id),
      id: String(id),
      payload: structuredClone(payload),
      payloadFingerprint: stableStringify(payload),
      state: 'pending',
      attempts: 0,
      availableAt: Number(availableAt),
      lastResult: null,
      leaseOwner: null,
      leaseUntil: null,
      createdAt: Number(now),
      updatedAt: Number(now),
    };
    try {
      await this.collection.insertOne(doc);
      return immutableJob(doc);
    } catch (error) {
      if (Number(error?.code) !== 11000) throw error;
      const existing = await this.collection.findOne({ _id: doc._id });
      if (!existing) {
        throw fail('VF_AEAT_OUTBOX_STORE_ERROR', 'AEAT outbox job was not persisted', 500, error);
      }
      if (existing.payloadFingerprint !== doc.payloadFingerprint) {
        throw fail(
          'VF_AEAT_OUTBOX_ID_CONFLICT',
          'AEAT outbox id already exists with different payload',
          409,
          error,
        );
      }
      return immutableJob(existing);
    }
  }

  async get(id) {
    return immutableJob(await this.collection.findOne({ _id: String(id) }));
  }

  async list() {
    const docs = await this.collection
      .find({})
      .sort({ availableAt: 1, id: 1 })
      .toArray();
    return docs.map(immutableJob);
  }

  async stats(now = Date.now()) {
    const docs = await this.collection
      .aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            pending: { $sum: { $cond: [{ $eq: ['$state', 'pending'] }, 1, 0] } },
            processing: { $sum: { $cond: [{ $eq: ['$state', 'processing'] }, 1, 0] } },
            reconciliationRequired: {
              $sum: { $cond: [{ $eq: ['$state', 'reconciliation_required'] }, 1, 0] },
            },
            completed: { $sum: { $cond: [{ $eq: ['$state', 'completed'] }, 1, 0] } },
            blocked: { $sum: { $cond: [{ $eq: ['$state', 'blocked'] }, 1, 0] } },
            duePending: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$state', 'pending'] },
                      { $lte: ['$availableAt', Number(now)] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            expiredProcessing: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$state', 'processing'] },
                      { $ne: ['$leaseUntil', null] },
                      { $lte: ['$leaseUntil', Number(now)] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            oldestPendingAt: {
              $min: {
                $cond: [
                  { $eq: ['$state', 'pending'] },
                  '$createdAt',
                  Number.MAX_SAFE_INTEGER,
                ],
              },
            },
            oldestReconciliationAt: {
              $min: {
                $cond: [
                  { $eq: ['$state', 'reconciliation_required'] },
                  '$updatedAt',
                  Number.MAX_SAFE_INTEGER,
                ],
              },
            },
          },
        },
      ])
      .next();

    const pendingValue = docs?.oldestPendingAt == null
      ? null
      : Number(docs.oldestPendingAt);
    const reconciliationValue = docs?.oldestReconciliationAt == null
      ? null
      : Number(docs.oldestReconciliationAt);
    const oldestPendingAt = pendingValue === Number.MAX_SAFE_INTEGER
      ? null
      : pendingValue;
    const oldestReconciliationAt = reconciliationValue === Number.MAX_SAFE_INTEGER
      ? null
      : reconciliationValue;
    return Object.freeze({
      total: Number(docs?.total ?? 0),
      pending: Number(docs?.pending ?? 0),
      processing: Number(docs?.processing ?? 0),
      reconciliationRequired: Number(docs?.reconciliationRequired ?? 0),
      completed: Number(docs?.completed ?? 0),
      blocked: Number(docs?.blocked ?? 0),
      duePending: Number(docs?.duePending ?? 0),
      expiredProcessing: Number(docs?.expiredProcessing ?? 0),
      oldestPendingAt,
      oldestPendingAgeMs: oldestPendingAt == null ? null : Math.max(0, Number(now) - oldestPendingAt),
      oldestReconciliationAt,
      oldestReconciliationAgeMs: oldestReconciliationAt == null
        ? null
        : Math.max(0, Number(now) - oldestReconciliationAt),
    });
  }

  async claim(id, { owner, now, leaseMs }) {
    const doc = await this.collection.findOneAndUpdate(
      {
        _id: String(id),
        state: 'pending',
        availableAt: { $lte: Number(now) },
      },
      {
        $set: {
          state: 'processing',
          leaseOwner: String(owner),
          leaseUntil: Number(now) + Number(leaseMs),
          updatedAt: Number(now),
        },
        $inc: { attempts: 1 },
      },
      { returnDocument: 'after' },
    );
    return immutableJob(doc);
  }

  async settle(id, {
    owner,
    state,
    availableAt = null,
    lastResult = null,
    now = Date.now(),
  }) {
    const current = await this.collection.findOne({ _id: String(id) });
    if (!current) {
      throw fail('VF_AEAT_OUTBOX_JOB_NOT_FOUND', 'Outbox job not found', 404);
    }
    const doc = await this.collection.findOneAndUpdate(
      {
        _id: String(id),
        state: 'processing',
        leaseOwner: String(owner),
      },
      {
        $set: {
          state: String(state),
          availableAt: availableAt == null ? Number(current.availableAt) : Number(availableAt),
          lastResult: lastResult == null ? null : structuredClone(lastResult),
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: Number(now),
        },
      },
      { returnDocument: 'after' },
    );
    if (!doc) {
      throw fail(
        'VF_AEAT_OUTBOX_LEASE_LOST',
        'AEAT outbox lease is no longer owned by this worker',
        409,
      );
    }
    return immutableJob(doc);
  }

  async recoverExpired(now = Date.now()) {
    const result = await this.collection.updateMany(
      {
        state: 'processing',
        leaseUntil: { $ne: null, $lte: Number(now) },
      },
      {
        $set: {
          state: 'reconciliation_required',
          lastResult: reconciliationResult('lease_expired_after_dispatch_start'),
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: Number(now),
        },
      },
    );
    return Number(result.modifiedCount ?? 0);
  }

  async resolveReconciliation(id, {
    action,
    availableAt = Date.now(),
    result = null,
    now = Date.now(),
  }) {
    const state = action === 'retry'
      ? 'pending'
      : action === 'complete'
        ? 'completed'
        : action === 'block'
          ? 'blocked'
          : null;
    if (!state) {
      throw fail(
        'VF_AEAT_OUTBOX_RECONCILIATION_ACTION_INVALID',
        'Unsupported reconciliation action',
        400,
      );
    }
    const current = await this.collection.findOne({ _id: String(id) });
    if (!current) {
      throw fail('VF_AEAT_OUTBOX_JOB_NOT_FOUND', 'Outbox job not found', 404);
    }
    const doc = await this.collection.findOneAndUpdate(
      {
        _id: String(id),
        state: 'reconciliation_required',
      },
      {
        $set: {
          state,
          availableAt: action === 'retry' ? Number(availableAt) : Number(current.availableAt),
          lastResult: structuredClone(result ?? { kind: 'manual_reconciliation', action }),
          updatedAt: Number(now),
        },
      },
      { returnDocument: 'after' },
    );
    if (!doc) {
      throw fail(
        'VF_AEAT_OUTBOX_NOT_RECONCILABLE',
        'Outbox job is not awaiting reconciliation',
        409,
      );
    }
    return immutableJob(doc);
  }
}

export function createMongoKairosethAeatOutboxStore(options) {
  return new MongoKairosethAeatOutboxStore(options);
}
