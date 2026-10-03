import { createReadOnlyDatabaseDriver } from './database-source.mjs';

function driverInputError(message) {
  return Object.assign(new Error(message), {
    code: 'VF_LOCAL_AGENT_DB_DRIVER_INVALID',
    retryable: false,
  });
}

async function rollbackQuietly(target) {
  try {
    await target.query('ROLLBACK');
  } catch {}
}

export function createPostgresReadOnlyDriver({ pool } = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('PostgreSQL pool with connect() is required');
  }

  async function withReadOnlyTransaction(operation) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const status = await client.query('SHOW transaction_read_only');
      if (String(status?.rows?.[0]?.transaction_read_only ?? '').toLowerCase() !== 'on') {
        throw Object.assign(new Error('PostgreSQL transaction is not read-only'), {
          code: 'VF_LOCAL_AGENT_DB_READ_ONLY_REQUIRED',
          retryable: false,
        });
      }
      return await operation(client);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
  }

  return createReadOnlyDatabaseDriver({
    dialect: 'postgresql',
    verifyReadOnly: async () => withReadOnlyTransaction(async () => true),
    fetchPage: async ({ query, cursor, limit }) => withReadOnlyTransaction(async (client) => {
      const result = await client.query(query, [cursor, limit]);
      return result?.rows ?? [];
    }),
  });
}

export function createMysqlReadOnlyDriver({ pool, dialect = 'mysql' } = {}) {
  if (!pool || typeof pool.getConnection !== 'function') {
    throw new TypeError('MySQL/MariaDB pool with getConnection() is required');
  }
  const normalizedDialect = String(dialect ?? '').trim().toLowerCase();
  if (!['mysql', 'mariadb'].includes(normalizedDialect)) {
    throw driverInputError('MySQL driver dialect must be mysql or mariadb');
  }

  async function withReadOnlyTransaction(operation) {
    const connection = await pool.getConnection();
    try {
      await connection.query('START TRANSACTION READ ONLY');
      return await operation(connection);
    } finally {
      try {
        await connection.rollback();
      } catch {}
      connection.release();
    }
  }

  return createReadOnlyDatabaseDriver({
    dialect: normalizedDialect,
    verifyReadOnly: async () => withReadOnlyTransaction(async (connection) => {
      const [rows] = await connection.query('SELECT 1 AS ok');
      return Number(rows?.[0]?.ok ?? 0) === 1;
    }),
    fetchPage: async ({ query, cursor, limit }) => withReadOnlyTransaction(async (connection) => {
      const executor = typeof connection.execute === 'function'
        ? connection.execute.bind(connection)
        : connection.query.bind(connection);
      const [rows] = await executor(query, [cursor, limit]);
      return Array.isArray(rows) ? rows : [];
    }),
  });
}

const SQLSERVER_READ_ONLY_PROBE = `
WITH principals AS (
  SELECT USER_ID() AS principal_id
  UNION ALL
  SELECT drm.role_principal_id
  FROM sys.database_role_members AS drm
  INNER JOIN principals AS p
    ON drm.member_principal_id = p.principal_id
),
write_grants AS (
  SELECT COUNT_BIG(*) AS write_grants
  FROM sys.database_permissions AS dp
  INNER JOIN principals AS p
    ON p.principal_id = dp.grantee_principal_id
  WHERE dp.state IN ('G', 'W')
    AND dp.permission_name IN (
      'INSERT', 'UPDATE', 'DELETE', 'ALTER', 'CONTROL', 'TAKE OWNERSHIP',
      'CREATE TABLE', 'CREATE VIEW', 'CREATE PROCEDURE', 'EXECUTE'
    )
)
SELECT
  CASE
    WHEN IS_SRVROLEMEMBER('sysadmin') = 1
      OR IS_MEMBER('db_owner') = 1
      OR IS_MEMBER('db_datawriter') = 1
      OR IS_MEMBER('db_ddladmin') = 1
      OR (SELECT write_grants FROM write_grants) > 0
    THEN CAST(0 AS bit)
    ELSE CAST(1 AS bit)
  END AS read_only,
  CASE
    WHEN IS_MEMBER('db_datareader') = 1
      OR HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'SELECT') = 1
    THEN CAST(1 AS bit)
    ELSE CAST(0 AS bit)
  END AS can_select
OPTION (MAXRECURSION 32);
`;

export function createSqlServerReadOnlyDriver({ pool } = {}) {
  if (!pool || typeof pool.request !== 'function') {
    throw new TypeError('SQL Server pool with request() is required');
  }

  async function verify() {
    const result = await pool.request().query(SQLSERVER_READ_ONLY_PROBE);
    const row = result?.recordset?.[0] ?? {};
    return Boolean(row.read_only) && Boolean(row.can_select);
  }

  return createReadOnlyDatabaseDriver({
    dialect: 'sqlserver',
    verifyReadOnly: verify,
    fetchPage: async ({ query, cursor, limit }) => {
      const request = pool.request();
      request.input('cursor', cursor);
      request.input('limit', limit);
      const result = await request.query(query);
      return result?.recordset ?? [];
    },
  });
}
