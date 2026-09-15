import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertFiscalAppend } from '../../core/src/fiscal-record-store.mjs';
import { fiscalOperationFingerprint } from '../../core/src/fiscal-records.mjs';
import { sha256, stableStringify } from '../../core/src/idempotency.mjs';
import { SqliteAeatOutboxStore } from './aeat-outbox.mjs';

export {
  createSqliteBackup,
  inspectSqliteFile,
  restoreSqliteBackup,
  verifySqliteBackup,
} from './backup.mjs';
export {
  BACKUP_LIFECYCLE_EVIDENCE_KINDS,
  buildBackupRetentionPlan,
  evaluateBackupLifecycle,
  loadBackupLifecyclePolicy,
  validateBackupLifecyclePolicy,
} from './backup-lifecycle.mjs';
export { SqliteAeatOutboxStore } from './aeat-outbox.mjs';

function parseJson(text) {
  return text == null ? null : JSON.parse(text);
}

function immutableClone(value) {
  return Object.freeze(structuredClone(value));
}

function integrationFingerprint(value) {
  return sha256(stableStringify(value));
}

function constraintError(error, code, message) {
  if (String(error?.code ?? '').startsWith('ERR_SQLITE_CONSTRAINT') || /constraint/i.test(String(error?.message ?? ''))) {
    return Object.assign(new Error(message), { code, cause: error });
  }
  return error;
}

export class PuenteSqliteDatabase {
  constructor(path) {
    if (!path) throw new TypeError('SQLite path is required');
    const resolved = path === ':memory:' ? path : resolve(path);
    if (resolved !== ':memory:') mkdirSync(dirname(resolved), { recursive: true });
    this.path = resolved;
    this.db = new DatabaseSync(resolved);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    if (resolved !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = FULL');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fiscal_records (
        chain_key TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chain_key, sequence)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS fiscal_operations (
        operation_key TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        chain_key TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        FOREIGN KEY (chain_key, sequence) REFERENCES fiscal_records(chain_key, sequence)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS api_records (
        record_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        installation_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_api_records_org
        ON api_records(organization_id, installation_id);

      CREATE TABLE IF NOT EXISTS api_requests (
        request_key TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        record_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (record_id) REFERENCES api_records(record_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS import_sessions (
        import_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        installation_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        session_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_import_sessions_expiry
        ON import_sessions(expires_at_ms);
    `);
  }

  close() {
    this.db.close();
  }
}

export class SqliteFiscalRecordStore {
  constructor(database) {
    this.database = database;
    this.db = database.db;
    this.selectLast = this.db.prepare('SELECT record_json FROM fiscal_records WHERE chain_key = ? ORDER BY sequence DESC LIMIT 1');
    this.selectChain = this.db.prepare('SELECT record_json FROM fiscal_records WHERE chain_key = ? ORDER BY sequence ASC');
    this.selectOperation = this.db.prepare(`
      SELECT o.fingerprint, r.record_json
      FROM fiscal_operations o
      JOIN fiscal_records r ON r.chain_key = o.chain_key AND r.sequence = o.sequence
      WHERE o.operation_key = ?
    `);
    this.insertRecord = this.db.prepare('INSERT INTO fiscal_records (chain_key, sequence, record_json) VALUES (?, ?, ?)');
    this.insertOperation = this.db.prepare('INSERT INTO fiscal_operations (operation_key, fingerprint, chain_key, sequence) VALUES (?, ?, ?, ?)');
  }

  last(chainKey) {
    const row = this.selectLast.get(chainKey);
    return row ? parseJson(row.record_json) : null;
  }

  list(chainKey) {
    return this.selectChain.all(chainKey).map((row) => parseJson(row.record_json));
  }

  findOperation(operationKey) {
    const row = this.selectOperation.get(operationKey);
    return row ? { record: parseJson(row.record_json), fingerprint: row.fingerprint } : null;
  }

  append(record, { operationKey, operationPayload }) {
    const previous = this.last(record.chainKey);
    const expectedSequence = previous ? previous.sequence + 1 : 1;
    assertFiscalAppend(previous, record, expectedSequence);
    try {
      this.insertRecord.run(record.chainKey, record.sequence, JSON.stringify(record));
      this.insertOperation.run(
        operationKey,
        fiscalOperationFingerprint(operationPayload),
        record.chainKey,
        record.sequence,
      );
    } catch (error) {
      throw constraintError(error, 'VF_CHAIN_CONCURRENCY_CONFLICT', 'Fiscal chain write conflicted with another writer');
    }
    return record;
  }

  async transact(chainKey, operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation({
        last: this.last(chainKey),
        findOperation: (operationKey) => this.findOperation(operationKey),
        append: (record, options) => this.append(record, options),
      });
      if (result && typeof result.then === 'function') {
        throw Object.assign(new Error('SQLite fiscal transaction callback must be synchronous'), { code: 'VF_SQLITE_ASYNC_TRANSACTION_UNSUPPORTED' });
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }
}

export class SqliteIntegrationStore {
  constructor(database) {
    this.database = database;
    this.db = database.db;
    this.selectRecord = this.db.prepare('SELECT record_json FROM api_records WHERE record_id = ?');
    this.insertRecord = this.db.prepare('INSERT INTO api_records (record_id, organization_id, installation_id, record_json) VALUES (?, ?, ?, ?)');
    this.selectRequest = this.db.prepare('SELECT fingerprint, record_id FROM api_requests WHERE request_key = ?');
    this.insertRequest = this.db.prepare('INSERT OR IGNORE INTO api_requests (request_key, fingerprint, record_id) VALUES (?, ?, NULL)');
    this.completeRequest = this.db.prepare('UPDATE api_requests SET record_id = ? WHERE request_key = ? AND fingerprint = ?');
    this.releaseRequest = this.db.prepare('DELETE FROM api_requests WHERE request_key = ? AND fingerprint = ? AND record_id IS NULL');
  }

  get(recordId) {
    const row = this.selectRecord.get(recordId);
    return row ? immutableClone(parseJson(row.record_json)) : null;
  }

  put(record) {
    const existing = this.get(record.recordId);
    if (existing) {
      if (stableStringify(existing) !== stableStringify(record)) {
        throw Object.assign(new Error('Record id already exists with different content'), { code: 'VF_API_RECORD_CONFLICT' });
      }
      return existing;
    }
    try {
      this.insertRecord.run(record.recordId, record.organizationId, record.installationId, JSON.stringify(record));
    } catch (error) {
      throw constraintError(error, 'VF_API_RECORD_CONFLICT', 'Record write conflicted with another writer');
    }
    return immutableClone(record);
  }

  reserve(key, payload) {
    const fingerprint = integrationFingerprint(payload);
    const inserted = this.insertRequest.run(key, fingerprint).changes === 1;
    const existing = this.selectRequest.get(key);
    if (!existing) throw Object.assign(new Error('Idempotency reservation was not persisted'), { code: 'VF_API_IDEMPOTENCY_STORE_ERROR' });
    if (existing.fingerprint !== fingerprint) {
      throw Object.assign(new Error('Idempotency-Key was already used with different content'), { code: 'VF_API_IDEMPOTENCY_CONFLICT', status: 409 });
    }
    return {
      existing: { fingerprint: existing.fingerprint, recordId: existing.record_id ?? null },
      duplicate: !inserted,
    };
  }

  complete(key, payload, recordId) {
    const fingerprint = integrationFingerprint(payload);
    const result = this.completeRequest.run(recordId, key, fingerprint);
    if (result.changes !== 1) throw Object.assign(new Error('Idempotency reservation could not be completed'), { code: 'VF_API_IDEMPOTENCY_STORE_ERROR' });
  }

  release(key, payload) {
    this.releaseRequest.run(key, integrationFingerprint(payload));
  }
}

export class SqliteImportSessionStore {
  constructor(database) {
    this.database = database;
    this.db = database.db;
    this.deleteExpired = this.db.prepare('DELETE FROM import_sessions WHERE expires_at_ms <= ?');
    this.countSessions = this.db.prepare('SELECT COUNT(*) AS total FROM import_sessions');
    this.oldestSessions = this.db.prepare('SELECT import_id FROM import_sessions ORDER BY created_at_ms ASC, import_id ASC LIMIT ?');
    this.deleteSession = this.db.prepare('DELETE FROM import_sessions WHERE import_id = ?');
    this.insertSession = this.db.prepare(`
      INSERT INTO import_sessions (import_id, organization_id, installation_id, created_at_ms, expires_at_ms, session_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(import_id) DO UPDATE SET
        organization_id = excluded.organization_id,
        installation_id = excluded.installation_id,
        created_at_ms = excluded.created_at_ms,
        expires_at_ms = excluded.expires_at_ms,
        session_json = excluded.session_json
    `);
    this.selectSession = this.db.prepare('SELECT session_json FROM import_sessions WHERE import_id = ?');
  }

  purgeExpired(now) {
    this.deleteExpired.run(now);
  }

  ensureCapacity(maxSessions, now) {
    this.purgeExpired(now);
    const count = Number(this.countSessions.get().total);
    const removeCount = Math.max(0, count - maxSessions + 1);
    if (removeCount > 0) {
      for (const row of this.oldestSessions.all(removeCount)) this.deleteSession.run(row.import_id);
    }
  }

  put(session) {
    this.insertSession.run(
      session.importId,
      session.organizationId,
      session.installationId,
      session.createdAt,
      session.expiresAt,
      JSON.stringify(session),
    );
    return session;
  }

  get(importId) {
    const row = this.selectSession.get(importId);
    return row ? parseJson(row.session_json) : null;
  }

  delete(importId) {
    return this.deleteSession.run(importId).changes > 0;
  }

  size() {
    return Number(this.countSessions.get().total);
  }
}

export function createSqlitePersistence({ path }) {
  const database = new PuenteSqliteDatabase(path);
  return {
    database,
    fiscalStore: new SqliteFiscalRecordStore(database),
    integrationStore: new SqliteIntegrationStore(database),
    importStore: new SqliteImportSessionStore(database),
    aeatOutbox: new SqliteAeatOutboxStore(database),
    close: () => database.close(),
  };
}
