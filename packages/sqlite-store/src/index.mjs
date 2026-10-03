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

      CREATE TABLE IF NOT EXISTS local_agent_installations (
        organization_id TEXT NOT NULL,
        installation_id TEXT NOT NULL,
        source_system TEXT NOT NULL,
        label TEXT,
        token_sha256 TEXT NOT NULL UNIQUE,
        credential_version INTEGER NOT NULL DEFAULT 1,
        revoked_at_ms INTEGER,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER,
        agent_version TEXT,
        platform TEXT,
        arch TEXT,
        source_kind TEXT,
        reported_status TEXT,
        queue_json TEXT,
        desired_version TEXT,
        update_policy TEXT NOT NULL DEFAULT 'manual'
          CHECK (update_policy IN ('manual', 'disabled')),
        PRIMARY KEY (organization_id, installation_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_local_agent_installations_seen
        ON local_agent_installations(last_seen_at_ms);
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


function localAgentPublicRow(row) {
  if (!row) return null;
  return immutableClone({
    organizationId: row.organization_id,
    installationId: row.installation_id,
    sourceSystem: row.source_system,
    label: row.label ?? null,
    credentialVersion: Number(row.credential_version),
    revoked: row.revoked_at_ms != null,
    revokedAt: row.revoked_at_ms == null ? null : Number(row.revoked_at_ms),
    createdAt: Number(row.created_at_ms),
    updatedAt: Number(row.updated_at_ms),
    lastSeenAt: row.last_seen_at_ms == null ? null : Number(row.last_seen_at_ms),
    agentVersion: row.agent_version ?? null,
    platform: row.platform ?? null,
    arch: row.arch ?? null,
    sourceKind: row.source_kind ?? null,
    reportedStatus: row.reported_status ?? null,
    queue: parseJson(row.queue_json),
    desiredVersion: row.desired_version ?? null,
    updatePolicy: row.update_policy,
  });
}

export class SqliteLocalAgentRegistryStore {
  constructor(database) {
    this.database = database;
    this.db = database.db;
    this.insert = this.db.prepare(`
      INSERT INTO local_agent_installations (
        organization_id, installation_id, source_system, label, token_sha256,
        credential_version, revoked_at_ms, created_at_ms, updated_at_ms,
        last_seen_at_ms, agent_version, platform, arch, source_kind,
        reported_status, queue_json, desired_version, update_policy
      ) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
    `);
    this.select = this.db.prepare(`
      SELECT * FROM local_agent_installations
      WHERE organization_id = ? AND installation_id = ?
    `);
    this.selectByToken = this.db.prepare(`
      SELECT * FROM local_agent_installations
      WHERE token_sha256 = ? AND revoked_at_ms IS NULL
      LIMIT 1
    `);
    this.listAll = this.db.prepare(`
      SELECT * FROM local_agent_installations
      ORDER BY organization_id ASC, installation_id ASC
    `);
    this.rotate = this.db.prepare(`
      UPDATE local_agent_installations
      SET token_sha256 = ?, credential_version = credential_version + 1,
          revoked_at_ms = NULL, updated_at_ms = ?
      WHERE organization_id = ? AND installation_id = ?
    `);
    this.revokeStmt = this.db.prepare(`
      UPDATE local_agent_installations
      SET revoked_at_ms = ?, updated_at_ms = ?
      WHERE organization_id = ? AND installation_id = ?
    `);
    this.control = this.db.prepare(`
      UPDATE local_agent_installations
      SET desired_version = ?, update_policy = ?, label = ?, updated_at_ms = ?
      WHERE organization_id = ? AND installation_id = ?
    `);
    this.heartbeatStmt = this.db.prepare(`
      UPDATE local_agent_installations
      SET last_seen_at_ms = ?, agent_version = ?, platform = ?, arch = ?,
          source_kind = ?, reported_status = ?, queue_json = ?, updated_at_ms = ?
      WHERE organization_id = ? AND installation_id = ? AND revoked_at_ms IS NULL
    `);
  }

  create(record) {
    try {
      this.insert.run(
        record.organizationId,
        record.installationId,
        record.sourceSystem,
        record.label,
        record.tokenSha256,
        record.now,
        record.now,
        record.desiredVersion,
        record.updatePolicy,
      );
    } catch (error) {
      const normalized = constraintError(
        error,
        'VF_LOCAL_AGENT_INSTALLATION_EXISTS',
        'Local Agent installation already exists',
      );
      if (normalized?.code === 'VF_LOCAL_AGENT_INSTALLATION_EXISTS') normalized.status = 409;
      throw normalized;
    }
    return this.get(record.organizationId, record.installationId);
  }

  get(organizationId, installationId) {
    return localAgentPublicRow(this.select.get(organizationId, installationId));
  }

  list() {
    return this.listAll.all().map(localAgentPublicRow);
  }

  authByTokenSha256(tokenSha256) {
    const row = this.selectByToken.get(tokenSha256);
    if (!row) return null;
    return Object.freeze({
      organizationId: row.organization_id,
      installationId: row.installation_id,
      sourceSystem: row.source_system,
      credentialVersion: Number(row.credential_version),
    });
  }

  rotateCredential({ organizationId, installationId, tokenSha256, now }) {
    if (this.rotate.run(tokenSha256, now, organizationId, installationId).changes !== 1) {
      throw Object.assign(new Error('Local Agent installation not found'), { code: 'VF_LOCAL_AGENT_INSTALLATION_NOT_FOUND', status: 404 });
    }
    return this.get(organizationId, installationId);
  }

  revoke({ organizationId, installationId, now }) {
    if (this.revokeStmt.run(now, now, organizationId, installationId).changes !== 1) {
      throw Object.assign(new Error('Local Agent installation not found'), { code: 'VF_LOCAL_AGENT_INSTALLATION_NOT_FOUND', status: 404 });
    }
    return this.get(organizationId, installationId);
  }

  setControl({ organizationId, installationId, desiredVersion, updatePolicy, label, now }) {
    if (this.control.run(desiredVersion, updatePolicy, label, now, organizationId, installationId).changes !== 1) {
      throw Object.assign(new Error('Local Agent installation not found'), { code: 'VF_LOCAL_AGENT_INSTALLATION_NOT_FOUND', status: 404 });
    }
    return this.get(organizationId, installationId);
  }

  heartbeat({ organizationId, installationId, agentVersion, platform, arch, sourceKind, reportedStatus, queue, now }) {
    const changed = this.heartbeatStmt.run(
      now,
      agentVersion,
      platform,
      arch,
      sourceKind,
      reportedStatus,
      JSON.stringify(queue),
      now,
      organizationId,
      installationId,
    ).changes;
    if (changed !== 1) {
      throw Object.assign(new Error('Local Agent installation is unavailable'), { code: 'VF_LOCAL_AGENT_INSTALLATION_UNAVAILABLE', status: 401 });
    }
    return this.get(organizationId, installationId);
  }
}

export function createSqlitePersistence({ path }) {
  const database = new PuenteSqliteDatabase(path);
  return {
    database,
    fiscalStore: new SqliteFiscalRecordStore(database),
    integrationStore: new SqliteIntegrationStore(database),
    importStore: new SqliteImportSessionStore(database),
    localAgentRegistry: new SqliteLocalAgentRegistryStore(database),
    aeatOutbox: new SqliteAeatOutboxStore(database),
    close: () => database.close(),
  };
}
