import { randomUUID } from 'node:crypto';

function parseJson(value) {
  return value == null ? null : JSON.parse(value);
}

function immutableJob(job) {
  return job == null ? null : Object.freeze(structuredClone(job));
}

function rowToJob(row) {
  if (!row) return null;
  return immutableJob({
    id: row.id,
    payload: parseJson(row.payload_json),
    state: row.state,
    attempts: Number(row.attempts),
    availableAt: Number(row.available_at_ms),
    lastResult: parseJson(row.last_result_json),
    leaseOwner: row.lease_owner ?? null,
    leaseUntil: row.lease_until_ms == null ? null : Number(row.lease_until_ms),
    createdAt: Number(row.created_at_ms),
    updatedAt: Number(row.updated_at_ms),
  });
}

function reconciliationResult(reason) {
  return JSON.stringify({
    kind: 'reconciliation_required',
    status: 'unknown',
    retryable: false,
    reason,
  });
}

export class SqliteAeatOutboxStore {
  constructor(database) {
    this.database = database;
    this.db = database.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS aeat_outbox (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'reconciliation_required', 'completed', 'blocked')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        available_at_ms INTEGER NOT NULL,
        last_result_json TEXT,
        lease_owner TEXT,
        lease_until_ms INTEGER,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_aeat_outbox_due
        ON aeat_outbox(state, available_at_ms, id);

      CREATE INDEX IF NOT EXISTS idx_aeat_outbox_lease
        ON aeat_outbox(state, lease_until_ms);
    `);

    this.select = this.db.prepare('SELECT * FROM aeat_outbox WHERE id = ?');
    this.selectAll = this.db.prepare('SELECT * FROM aeat_outbox ORDER BY available_at_ms ASC, id ASC');
    this.selectStats = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN state = 'processing' THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN state = 'reconciliation_required' THEN 1 ELSE 0 END) AS reconciliation_required,
        SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN state = 'blocked' THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN state = 'pending' AND available_at_ms <= ? THEN 1 ELSE 0 END) AS due_pending,
        SUM(CASE WHEN state = 'processing' AND lease_until_ms IS NOT NULL AND lease_until_ms <= ? THEN 1 ELSE 0 END) AS expired_processing,
        MIN(CASE WHEN state = 'pending' THEN created_at_ms ELSE NULL END) AS oldest_pending_created_at_ms,
        MIN(CASE WHEN state = 'reconciliation_required' THEN updated_at_ms ELSE NULL END) AS oldest_reconciliation_at_ms
      FROM aeat_outbox
    `);
    this.insert = this.db.prepare(`
      INSERT OR IGNORE INTO aeat_outbox (
        id, payload_json, state, attempts, available_at_ms, last_result_json,
        lease_owner, lease_until_ms, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?, ?)
    `);
    this.claimJob = this.db.prepare(`
      UPDATE aeat_outbox
      SET state = 'processing',
          attempts = attempts + 1,
          lease_owner = ?,
          lease_until_ms = ?,
          updated_at_ms = ?
      WHERE id = ? AND state = 'pending' AND available_at_ms <= ?
    `);
    this.settleJob = this.db.prepare(`
      UPDATE aeat_outbox
      SET state = ?, available_at_ms = ?, last_result_json = ?,
          lease_owner = NULL, lease_until_ms = NULL, updated_at_ms = ?
      WHERE id = ? AND state = 'processing' AND lease_owner = ?
    `);
    this.recoverExpiredJobs = this.db.prepare(`
      UPDATE aeat_outbox
      SET state = 'reconciliation_required',
          last_result_json = ?,
          lease_owner = NULL,
          lease_until_ms = NULL,
          updated_at_ms = ?
      WHERE state = 'processing' AND lease_until_ms IS NOT NULL AND lease_until_ms <= ?
    `);
    this.resolveReconciliationJob = this.db.prepare(`
      UPDATE aeat_outbox
      SET state = ?, available_at_ms = ?, last_result_json = ?, updated_at_ms = ?
      WHERE id = ? AND state = 'reconciliation_required'
    `);
  }

  enqueue(payload, { availableAt = Date.now(), id = `aeat_${randomUUID()}`, now = Date.now() } = {}) {
    const payloadJson = JSON.stringify(payload);
    const inserted = this.insert.run(id, payloadJson, availableAt, now, now).changes === 1;
    const job = this.get(id);
    if (!job) throw Object.assign(new Error('AEAT outbox job was not persisted'), { code: 'VF_AEAT_OUTBOX_STORE_ERROR' });
    if (!inserted && JSON.stringify(job.payload) !== payloadJson) {
      throw Object.assign(new Error('AEAT outbox id already exists with different payload'), { code: 'VF_AEAT_OUTBOX_ID_CONFLICT' });
    }
    return job;
  }

  get(id) {
    return rowToJob(this.select.get(id));
  }

  list() {
    return this.selectAll.all().map(rowToJob);
  }

  stats(now = Date.now()) {
    const row = this.selectStats.get(now, now);
    const oldestPendingAt = row?.oldest_pending_created_at_ms == null ? null : Number(row.oldest_pending_created_at_ms);
    const oldestReconciliationAt = row?.oldest_reconciliation_at_ms == null ? null : Number(row.oldest_reconciliation_at_ms);
    return Object.freeze({
      total: Number(row?.total ?? 0),
      pending: Number(row?.pending ?? 0),
      processing: Number(row?.processing ?? 0),
      reconciliationRequired: Number(row?.reconciliation_required ?? 0),
      completed: Number(row?.completed ?? 0),
      blocked: Number(row?.blocked ?? 0),
      duePending: Number(row?.due_pending ?? 0),
      expiredProcessing: Number(row?.expired_processing ?? 0),
      oldestPendingAt,
      oldestPendingAgeMs: oldestPendingAt == null ? null : Math.max(0, now - oldestPendingAt),
      oldestReconciliationAt,
      oldestReconciliationAgeMs: oldestReconciliationAt == null ? null : Math.max(0, now - oldestReconciliationAt),
    });
  }

  claim(id, { owner, now, leaseMs }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.claimJob.run(owner, now + leaseMs, now, id, now);
      const job = result.changes === 1 ? this.get(id) : null;
      this.db.exec('COMMIT');
      return job;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  settle(id, { owner, state, availableAt = null, lastResult = null, now = Date.now() }) {
    const current = this.get(id);
    if (!current) throw Object.assign(new Error('Outbox job not found'), { code: 'VF_AEAT_OUTBOX_JOB_NOT_FOUND' });
    const nextAvailableAt = availableAt ?? current.availableAt;
    const result = this.settleJob.run(
      state,
      nextAvailableAt,
      lastResult == null ? null : JSON.stringify(lastResult),
      now,
      id,
      owner,
    );
    if (result.changes !== 1) {
      throw Object.assign(new Error('AEAT outbox lease is no longer owned by this worker'), { code: 'VF_AEAT_OUTBOX_LEASE_LOST' });
    }
    return this.get(id);
  }

  recoverExpired(now = Date.now()) {
    return Number(this.recoverExpiredJobs.run(
      reconciliationResult('lease_expired_after_dispatch_start'),
      now,
      now,
    ).changes);
  }

  resolveReconciliation(id, { action, availableAt = Date.now(), result = null, now = Date.now() }) {
    const state = action === 'retry' ? 'pending' : action === 'complete' ? 'completed' : action === 'block' ? 'blocked' : null;
    if (!state) throw Object.assign(new Error('Unsupported reconciliation action'), { code: 'VF_AEAT_OUTBOX_RECONCILIATION_ACTION_INVALID' });
    const current = this.get(id);
    if (!current) throw Object.assign(new Error('Outbox job not found'), { code: 'VF_AEAT_OUTBOX_JOB_NOT_FOUND' });
    const finalResult = result ?? { kind: 'manual_reconciliation', action };
    const changed = this.resolveReconciliationJob.run(
      state,
      action === 'retry' ? availableAt : current.availableAt,
      JSON.stringify(finalResult),
      now,
      id,
    ).changes;
    if (changed !== 1) {
      throw Object.assign(new Error('Outbox job is not awaiting reconciliation'), { code: 'VF_AEAT_OUTBOX_NOT_RECONCILABLE' });
    }
    return this.get(id);
  }
}
