const DEFAULT_TABLE = 'public.kairoseth_local_agent_installations';
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

function fail(code, message, status = 500, cause = null) {
  return Object.assign(new Error(message), {
    code,
    status,
    ...(cause ? { cause } : {}),
  });
}

function quoteIdentifierPart(value) {
  if (!IDENTIFIER.test(value)) {
    throw new TypeError(`Invalid PostgreSQL identifier: ${value}`);
  }
  return `"${value}"`;
}

export function normalizePostgresRegistryTableName(value = DEFAULT_TABLE) {
  const parts = String(value ?? '').trim().split('.');
  if (parts.length < 1 || parts.length > 2 || parts.some((part) => !IDENTIFIER.test(part))) {
    throw new TypeError('tableName must be a PostgreSQL table or schema.table identifier');
  }
  return Object.freeze({
    logical: parts.join('.'),
    sql: parts.map(quoteIdentifierPart).join('.'),
  });
}

function rowToPublic(row) {
  if (!row) return null;
  return Object.freeze({
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
    queue: row.queue_json ?? null,
    desiredVersion: row.desired_version ?? null,
    updatePolicy: row.update_policy,
  });
}

function assertPool(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('Kairoseth PostgreSQL pool with query() is required');
  }
  return pool;
}

function postgresError(error, fallbackCode = 'VF_LOCAL_AGENT_REGISTRY_POSTGRES_ERROR') {
  if (error?.code === '23505') {
    return fail(
      'VF_LOCAL_AGENT_INSTALLATION_EXISTS',
      'Local Agent installation already exists',
      409,
      error,
    );
  }
  return fail(fallbackCode, 'Kairoseth Local Agent registry operation failed', 500, error);
}

export function postgresLocalAgentRegistryMigrationSql({
  tableName = DEFAULT_TABLE,
} = {}) {
  const table = normalizePostgresRegistryTableName(tableName);
  return `
CREATE TABLE IF NOT EXISTS ${table.sql} (
  organization_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  label TEXT,
  token_sha256 CHAR(64) NOT NULL UNIQUE,
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  revoked_at_ms BIGINT,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  last_seen_at_ms BIGINT,
  agent_version TEXT,
  platform TEXT,
  arch TEXT,
  source_kind TEXT,
  reported_status TEXT,
  queue_json JSONB,
  desired_version TEXT,
  update_policy TEXT NOT NULL DEFAULT 'manual'
    CHECK (update_policy IN ('manual', 'disabled')),
  PRIMARY KEY (organization_id, installation_id),
  CHECK (token_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS ${quoteIdentifierPart(
    `${table.logical.replace('.', '_')}_last_seen_idx`.slice(0, 63),
  )}
  ON ${table.sql} (last_seen_at_ms);
`.trim();
}

export class PostgresKairosethLocalAgentRegistryStore {
  constructor({
    pool,
    tableName = DEFAULT_TABLE,
  } = {}) {
    this.pool = assertPool(pool);
    this.table = normalizePostgresRegistryTableName(tableName);
  }

  migrationSql() {
    return postgresLocalAgentRegistryMigrationSql({ tableName: this.table.logical });
  }

  async get(organizationId, installationId) {
    const result = await this.pool.query(
      `SELECT * FROM ${this.table.sql}
       WHERE organization_id = $1 AND installation_id = $2
       LIMIT 1`,
      [organizationId, installationId],
    );
    return rowToPublic(result.rows?.[0] ?? null);
  }

  async list() {
    const result = await this.pool.query(
      `SELECT * FROM ${this.table.sql}
       ORDER BY organization_id ASC, installation_id ASC`,
    );
    return Object.freeze((result.rows ?? []).map(rowToPublic));
  }

  async authByTokenSha256(tokenSha256) {
    const result = await this.pool.query(
      `SELECT organization_id, installation_id, source_system, credential_version
       FROM ${this.table.sql}
       WHERE token_sha256 = $1 AND revoked_at_ms IS NULL
       LIMIT 1`,
      [tokenSha256],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return Object.freeze({
      organizationId: row.organization_id,
      installationId: row.installation_id,
      sourceSystem: row.source_system,
      credentialVersion: Number(row.credential_version),
    });
  }

  async create(record) {
    try {
      const result = await this.pool.query(
        `INSERT INTO ${this.table.sql} (
          organization_id, installation_id, source_system, label, token_sha256,
          credential_version, revoked_at_ms, created_at_ms, updated_at_ms,
          last_seen_at_ms, agent_version, platform, arch, source_kind,
          reported_status, queue_json, desired_version, update_policy
        ) VALUES (
          $1, $2, $3, $4, $5,
          1, NULL, $6, $6,
          NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, $7, $8
        )
        RETURNING *`,
        [
          record.organizationId,
          record.installationId,
          record.sourceSystem,
          record.label,
          record.tokenSha256,
          record.now,
          record.desiredVersion,
          record.updatePolicy,
        ],
      );
      return rowToPublic(result.rows?.[0] ?? null);
    } catch (error) {
      throw postgresError(error);
    }
  }

  async rotateCredential({ organizationId, installationId, tokenSha256, now }) {
    try {
      const result = await this.pool.query(
        `UPDATE ${this.table.sql}
         SET token_sha256 = $1,
             credential_version = credential_version + 1,
             revoked_at_ms = NULL,
             updated_at_ms = $2
         WHERE organization_id = $3 AND installation_id = $4
         RETURNING *`,
        [tokenSha256, now, organizationId, installationId],
      );
      if (!result.rows?.[0]) {
        throw fail('VF_LOCAL_AGENT_INSTALLATION_NOT_FOUND', 'Local Agent installation not found', 404);
      }
      return rowToPublic(result.rows[0]);
    } catch (error) {
      if (String(error?.code ?? '').startsWith('VF_')) throw error;
      throw postgresError(error);
    }
  }

  async revoke({ organizationId, installationId, now }) {
    try {
      const result = await this.pool.query(
        `UPDATE ${this.table.sql}
         SET revoked_at_ms = $1, updated_at_ms = $1
         WHERE organization_id = $2 AND installation_id = $3
         RETURNING *`,
        [now, organizationId, installationId],
      );
      if (!result.rows?.[0]) {
        throw fail('VF_LOCAL_AGENT_INSTALLATION_NOT_FOUND', 'Local Agent installation not found', 404);
      }
      return rowToPublic(result.rows[0]);
    } catch (error) {
      if (String(error?.code ?? '').startsWith('VF_')) throw error;
      throw postgresError(error);
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
      const result = await this.pool.query(
        `UPDATE ${this.table.sql}
         SET desired_version = $1,
             update_policy = $2,
             label = $3,
             updated_at_ms = $4
         WHERE organization_id = $5 AND installation_id = $6
         RETURNING *`,
        [desiredVersion, updatePolicy, label, now, organizationId, installationId],
      );
      if (!result.rows?.[0]) {
        throw fail('VF_LOCAL_AGENT_INSTALLATION_NOT_FOUND', 'Local Agent installation not found', 404);
      }
      return rowToPublic(result.rows[0]);
    } catch (error) {
      if (String(error?.code ?? '').startsWith('VF_')) throw error;
      throw postgresError(error);
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
      const result = await this.pool.query(
        `UPDATE ${this.table.sql}
         SET last_seen_at_ms = $1,
             agent_version = $2,
             platform = $3,
             arch = $4,
             source_kind = $5,
             reported_status = $6,
             queue_json = $7::jsonb,
             updated_at_ms = $1
         WHERE organization_id = $8
           AND installation_id = $9
           AND revoked_at_ms IS NULL
         RETURNING *`,
        [
          now,
          agentVersion,
          platform,
          arch,
          sourceKind,
          reportedStatus,
          JSON.stringify(queue),
          organizationId,
          installationId,
        ],
      );
      if (!result.rows?.[0]) {
        throw fail(
          'VF_LOCAL_AGENT_INSTALLATION_UNAVAILABLE',
          'Local Agent installation is unavailable',
          401,
        );
      }
      return rowToPublic(result.rows[0]);
    } catch (error) {
      if (String(error?.code ?? '').startsWith('VF_')) throw error;
      throw postgresError(error);
    }
  }
}

export function createPostgresKairosethLocalAgentRegistryStore(options) {
  return new PostgresKairosethLocalAgentRegistryStore(options);
}
