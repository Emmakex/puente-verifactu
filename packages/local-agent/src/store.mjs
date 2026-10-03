import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sha256, stableStringify } from '../../core/src/idempotency.mjs';

function parseJson(value) {
  return value == null ? null : JSON.parse(value);
}

function clone(value) {
  return value == null ? null : structuredClone(value);
}

function fingerprint(value) {
  return sha256(stableStringify(value));
}

function rowToJob(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    sourceId: row.source_id,
    sourceKey: row.source_key,
    payload: clone(parseJson(row.payload_json)),
    payloadFingerprint: row.payload_fingerprint,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    attempts: Number(row.attempts),
    availableAt: Number(row.available_at_ms),
    leaseOwner: row.lease_owner ?? null,
    leaseUntil: row.lease_until_ms == null ? null : Number(row.lease_until_ms),
    recordId: row.record_id ?? null,
    result: clone(parseJson(row.result_json)),
    error: clone(parseJson(row.error_json)),
    createdAt: Number(row.created_at_ms),
    updatedAt: Number(row.updated_at_ms),
    redacted: row.payload_json === 'null' && row.result_json == null,
  });
}

function safeAgentId(sourceId, sourceKey) {
  return `lag_${sha256(`${sourceId}\u0000${sourceKey}`).slice(0, 32)}`;
}

function safeIdempotencyKey(sourceId, sourceKey) {
  return `local-agent:${sha256(`${sourceId}\u0000${sourceKey}`)}`;
}

function validateText(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw Object.assign(new Error(`${name} is required`), { code: 'VF_LOCAL_AGENT_INPUT_INVALID' });
  return text;
}

export class LocalAgentStore {
  constructor(path) {
    if (!path) throw new TypeError('Local Agent SQLite path is required');
    const resolved = path === ':memory:' ? path : resolve(path);
    if (resolved !== ':memory:') mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
    this.path = resolved;
    this.db = new DatabaseSync(resolved);
    if (resolved !== ':memory:') {
      try {
        chmodSync(resolved, 0o600);
      } catch (error) {
        if (process.platform !== 'win32') throw error;
      }
    }
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    if (resolved !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = FULL');
    this.migrate();
    this.prepare();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_agent_jobs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_fingerprint TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'completed', 'blocked')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        available_at_ms INTEGER NOT NULL,
        lease_owner TEXT,
        lease_until_ms INTEGER,
        record_id TEXT,
        result_json TEXT,
        error_json TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        UNIQUE(source_id, source_key)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_local_agent_jobs_due
        ON local_agent_jobs(state, available_at_ms, id);

      CREATE INDEX IF NOT EXISTS idx_local_agent_jobs_lease
        ON local_agent_jobs(state, lease_until_ms);

      CREATE TABLE IF NOT EXISTS local_agent_checkpoints (
        source_id TEXT PRIMARY KEY,
        cursor_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS local_agent_source_receipts (
        source_id TEXT NOT NULL,
        source_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY(source_id, source_key)
      ) STRICT;
    `);
  }

  prepare() {
    this.insertJob = this.db.prepare(`
      INSERT OR IGNORE INTO local_agent_jobs (
        id, source_id, source_key, payload_json, payload_fingerprint, idempotency_key,
        state, attempts, available_at_ms, lease_owner, lease_until_ms, record_id,
        result_json, error_json, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
    `);
    this.selectJob = this.db.prepare('SELECT * FROM local_agent_jobs WHERE id = ?');
    this.selectSourceJob = this.db.prepare('SELECT * FROM local_agent_jobs WHERE source_id = ? AND source_key = ?');
    this.selectDue = this.db.prepare(`
      SELECT id FROM local_agent_jobs
      WHERE state = 'pending' AND available_at_ms <= ?
      ORDER BY available_at_ms ASC, created_at_ms ASC, id ASC
      LIMIT 1
    `);
    this.claimJob = this.db.prepare(`
      UPDATE local_agent_jobs
      SET state = 'processing',
          attempts = attempts + 1,
          lease_owner = ?,
          lease_until_ms = ?,
          updated_at_ms = ?
      WHERE id = ? AND state = 'pending' AND available_at_ms <= ?
    `);
    this.completeJob = this.db.prepare(`
      UPDATE local_agent_jobs
      SET state = 'completed',
          record_id = ?,
          result_json = ?,
          error_json = NULL,
          lease_owner = NULL,
          lease_until_ms = NULL,
          updated_at_ms = ?
      WHERE id = ? AND state = 'processing' AND lease_owner = ?
    `);
    this.retryJob = this.db.prepare(`
      UPDATE local_agent_jobs
      SET state = 'pending',
          available_at_ms = ?,
          error_json = ?,
          lease_owner = NULL,
          lease_until_ms = NULL,
          updated_at_ms = ?
      WHERE id = ? AND state = 'processing' AND lease_owner = ?
    `);
    this.blockJob = this.db.prepare(`
      UPDATE local_agent_jobs
      SET state = 'blocked',
          error_json = ?,
          lease_owner = NULL,
          lease_until_ms = NULL,
          updated_at_ms = ?
      WHERE id = ? AND state = 'processing' AND lease_owner = ?
    `);
    this.recoverExpiredJobs = this.db.prepare(`
      UPDATE local_agent_jobs
      SET state = 'pending',
          lease_owner = NULL,
          lease_until_ms = NULL,
          available_at_ms = ?,
          updated_at_ms = ?
      WHERE state = 'processing'
        AND lease_until_ms IS NOT NULL
        AND lease_until_ms <= ?
    `);
    this.listJobsStmt = this.db.prepare('SELECT * FROM local_agent_jobs ORDER BY created_at_ms ASC, id ASC');
    this.redactTerminalJobStmt = this.db.prepare(`
      UPDATE local_agent_jobs
      SET payload_json = 'null',
          result_json = NULL,
          error_json = ?
      WHERE id = ? AND state IN ('completed', 'blocked')
    `);
    this.selectRedactableTerminalJobs = this.db.prepare(`
      SELECT id
      FROM local_agent_jobs
      WHERE state IN ('completed', 'blocked')
        AND updated_at_ms <= ?
        AND (payload_json <> 'null' OR result_json IS NOT NULL)
      ORDER BY updated_at_ms ASC, id ASC
      LIMIT ?
    `);
    this.statsStmt = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN state = 'processing' THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN state = 'blocked' THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN state = 'pending' AND available_at_ms <= ? THEN 1 ELSE 0 END) AS due,
        SUM(CASE WHEN state = 'processing' AND lease_until_ms IS NOT NULL AND lease_until_ms <= ? THEN 1 ELSE 0 END) AS expired
      FROM local_agent_jobs
    `);
    this.upsertCheckpoint = this.db.prepare(`
      INSERT INTO local_agent_checkpoints (source_id, cursor_json, updated_at_ms)
      VALUES (?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        cursor_json = excluded.cursor_json,
        updated_at_ms = excluded.updated_at_ms
    `);
    this.selectCheckpoint = this.db.prepare('SELECT cursor_json, updated_at_ms FROM local_agent_checkpoints WHERE source_id = ?');
    this.insertSourceReceipt = this.db.prepare(`
      INSERT OR IGNORE INTO local_agent_source_receipts (
        source_id, source_key, fingerprint, metadata_json, created_at_ms
      ) VALUES (?, ?, ?, ?, ?)
    `);
    this.selectSourceReceipt = this.db.prepare(`
      SELECT source_id, source_key, fingerprint, metadata_json, created_at_ms
      FROM local_agent_source_receipts
      WHERE source_id = ? AND source_key = ?
    `);
  }

  close() {
    this.db.close();
  }

  enqueue({ sourceId, sourceKey, payload, availableAt = Date.now(), now = Date.now() } = {}) {
    const normalizedSourceId = validateText(sourceId, 'sourceId');
    const normalizedSourceKey = validateText(sourceKey, 'sourceKey');
    if (payload == null || typeof payload !== 'object') {
      throw Object.assign(new Error('payload must be an object'), { code: 'VF_LOCAL_AGENT_INPUT_INVALID' });
    }

    const payloadJson = JSON.stringify(payload);
    const payloadFingerprint = fingerprint(payload);
    const id = safeAgentId(normalizedSourceId, normalizedSourceKey);
    const idempotencyKey = safeIdempotencyKey(normalizedSourceId, normalizedSourceKey);

    const inserted = this.insertJob.run(
      id,
      normalizedSourceId,
      normalizedSourceKey,
      payloadJson,
      payloadFingerprint,
      idempotencyKey,
      Number(availableAt),
      Number(now),
      Number(now),
    ).changes === 1;

    const existing = this.selectSourceJob.get(normalizedSourceId, normalizedSourceKey);
    if (!existing) {
      throw Object.assign(new Error('Local Agent job was not persisted'), { code: 'VF_LOCAL_AGENT_STORE_ERROR' });
    }
    if (!inserted && existing.payload_fingerprint !== payloadFingerprint) {
      throw Object.assign(new Error('Source key already exists with different payload'), {
        code: 'VF_LOCAL_AGENT_SOURCE_KEY_CONFLICT',
      });
    }
    return rowToJob(existing);
  }

  get(id) {
    return rowToJob(this.selectJob.get(id));
  }

  list() {
    return this.listJobsStmt.all().map(rowToJob);
  }

  recoverExpired(now = Date.now()) {
    return Number(this.recoverExpiredJobs.run(now, now, now).changes);
  }

  claimNext({ owner, now = Date.now(), leaseMs = 60_000 } = {}) {
    const leaseOwner = validateText(owner, 'owner');
    const lease = Number(leaseMs);
    if (!Number.isFinite(lease) || lease < 1_000) {
      throw Object.assign(new Error('leaseMs must be at least 1000ms'), { code: 'VF_LOCAL_AGENT_INPUT_INVALID' });
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.recoverExpired(now);
      const due = this.selectDue.get(now);
      if (!due) {
        this.db.exec('COMMIT');
        return null;
      }
      const changed = this.claimJob.run(leaseOwner, now + lease, now, due.id, now).changes;
      const job = changed === 1 ? this.get(due.id) : null;
      this.db.exec('COMMIT');
      return job;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  complete(id, { owner, recordId = null, result = null, now = Date.now() } = {}) {
    const changed = this.completeJob.run(
      recordId == null ? null : String(recordId),
      result == null ? null : JSON.stringify(result),
      now,
      id,
      validateText(owner, 'owner'),
    ).changes;
    if (changed !== 1) {
      throw Object.assign(new Error('Local Agent job lease is no longer owned by this worker'), {
        code: 'VF_LOCAL_AGENT_LEASE_LOST',
      });
    }
    return this.get(id);
  }

  retry(id, { owner, availableAt, error = null, now = Date.now() } = {}) {
    const when = Number(availableAt);
    if (!Number.isFinite(when)) {
      throw Object.assign(new Error('availableAt is required for retry'), { code: 'VF_LOCAL_AGENT_INPUT_INVALID' });
    }
    const changed = this.retryJob.run(
      when,
      error == null ? null : JSON.stringify(error),
      now,
      id,
      validateText(owner, 'owner'),
    ).changes;
    if (changed !== 1) {
      throw Object.assign(new Error('Local Agent job lease is no longer owned by this worker'), {
        code: 'VF_LOCAL_AGENT_LEASE_LOST',
      });
    }
    return this.get(id);
  }

  block(id, { owner, error = null, now = Date.now() } = {}) {
    const changed = this.blockJob.run(
      error == null ? null : JSON.stringify(error),
      now,
      id,
      validateText(owner, 'owner'),
    ).changes;
    if (changed !== 1) {
      throw Object.assign(new Error('Local Agent job lease is no longer owned by this worker'), {
        code: 'VF_LOCAL_AGENT_LEASE_LOST',
      });
    }
    return this.get(id);
  }

  redactTerminal(id) {
    const current = this.get(id);
    if (!current) {
      throw Object.assign(new Error('Local Agent job not found'), { code: 'VF_LOCAL_AGENT_JOB_NOT_FOUND' });
    }
    if (!['completed', 'blocked'].includes(current.state)) {
      throw Object.assign(new Error('Only terminal Local Agent jobs can be redacted'), {
        code: 'VF_LOCAL_AGENT_JOB_NOT_TERMINAL',
      });
    }

    const sanitizedError = current.error
      ? {
          code: String(current.error.code ?? 'VF_LOCAL_AGENT_ERROR'),
          status: Number.isFinite(Number(current.error.status)) ? Number(current.error.status) : null,
          retryable: Boolean(current.error.retryable),
        }
      : null;

    this.redactTerminalJobStmt.run(
      sanitizedError == null ? null : JSON.stringify(sanitizedError),
      id,
    );
    return this.get(id);
  }

  redactTerminalPayloads({ before = Date.now(), limit = 500 } = {}) {
    const cutoff = Number(before);
    const maximum = Number(limit);
    if (!Number.isFinite(cutoff) || !Number.isInteger(maximum) || maximum < 1 || maximum > 10_000) {
      throw Object.assign(new Error('Invalid terminal-redaction limits'), { code: 'VF_LOCAL_AGENT_INPUT_INVALID' });
    }

    const ids = this.selectRedactableTerminalJobs.all(cutoff, maximum).map((row) => row.id);
    for (const id of ids) this.redactTerminal(id);
    return Object.freeze({ redacted: ids.length, ids: Object.freeze(ids) });
  }

  stats(now = Date.now()) {
    const row = this.statsStmt.get(now, now);
    return Object.freeze({
      total: Number(row?.total ?? 0),
      pending: Number(row?.pending ?? 0),
      processing: Number(row?.processing ?? 0),
      completed: Number(row?.completed ?? 0),
      blocked: Number(row?.blocked ?? 0),
      due: Number(row?.due ?? 0),
      expired: Number(row?.expired ?? 0),
    });
  }

  setCheckpoint(sourceId, cursor, now = Date.now()) {
    const id = validateText(sourceId, 'sourceId');
    if (cursor == null || typeof cursor !== 'object') {
      throw Object.assign(new Error('checkpoint cursor must be an object'), { code: 'VF_LOCAL_AGENT_INPUT_INVALID' });
    }
    this.upsertCheckpoint.run(id, JSON.stringify(cursor), Number(now));
    return this.getCheckpoint(id);
  }

  getCheckpoint(sourceId) {
    const id = validateText(sourceId, 'sourceId');
    const row = this.selectCheckpoint.get(id);
    if (!row) return null;
    return Object.freeze({
      sourceId: id,
      cursor: clone(parseJson(row.cursor_json)),
      updatedAt: Number(row.updated_at_ms),
    });
  }

  recordSourceReceipt({ sourceId, sourceKey, fingerprint: valueFingerprint, metadata = {}, now = Date.now() } = {}) {
    const id = validateText(sourceId, 'sourceId');
    const key = validateText(sourceKey, 'sourceKey');
    const digest = validateText(valueFingerprint, 'fingerprint');
    if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw Object.assign(new Error('receipt metadata must be an object'), { code: 'VF_LOCAL_AGENT_INPUT_INVALID' });
    }

    const inserted = this.insertSourceReceipt.run(
      id,
      key,
      digest,
      JSON.stringify(metadata),
      Number(now),
    ).changes === 1;
    const receipt = this.getSourceReceipt(id, key);
    if (!receipt) {
      throw Object.assign(new Error('Local Agent source receipt was not persisted'), {
        code: 'VF_LOCAL_AGENT_STORE_ERROR',
      });
    }
    if (!inserted && receipt.fingerprint !== digest) {
      throw Object.assign(new Error('Source receipt already exists with a different fingerprint'), {
        code: 'VF_LOCAL_AGENT_SOURCE_RECEIPT_CONFLICT',
      });
    }
    return receipt;
  }

  getSourceReceipt(sourceId, sourceKey) {
    const id = validateText(sourceId, 'sourceId');
    const key = validateText(sourceKey, 'sourceKey');
    const row = this.selectSourceReceipt.get(id, key);
    if (!row) return null;
    return Object.freeze({
      sourceId: row.source_id,
      sourceKey: row.source_key,
      fingerprint: row.fingerprint,
      metadata: clone(parseJson(row.metadata_json)),
      createdAt: Number(row.created_at_ms),
    });
  }
}

export function createLocalAgentStore({ path }) {
  return new LocalAgentStore(path);
}
