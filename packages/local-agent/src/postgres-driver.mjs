import { assertReadOnlySelect, createReadOnlyDatabaseDriver } from './database-source.mjs';

function inputError(message, code = 'VF_LOCAL_AGENT_POSTGRES_INPUT_INVALID') {
  return Object.assign(new Error(message), { code, retryable: false });
}

function normalizePositiveInteger(value, fallback, name, max = 120_000) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw inputError(`${name} must be an integer between 1 and ${max}`);
  }
  return number;
}

async function resolvePgModule(pgModule) {
  if (pgModule) return pgModule;
  try {
    return await import('pg');
  } catch (error) {
    throw Object.assign(new Error('PostgreSQL runtime requires the optional pg@8 client'), {
      code: 'VF_LOCAL_AGENT_POSTGRES_CLIENT_MISSING',
      retryable: false,
      cause: error,
    });
  }
}

function getClientConstructor(pgModule) {
  const Client = pgModule?.Client ?? pgModule?.default?.Client;
  if (typeof Client !== 'function') {
    throw inputError('pg module does not expose Client', 'VF_LOCAL_AGENT_POSTGRES_CLIENT_INVALID');
  }
  return Client;
}

function normalizeConnection({ connectionString = null, connection = null, applicationName, connectionTimeoutMs }) {
  if (connectionString && connection) {
    throw inputError('Use either connectionString or connection, not both');
  }
  if (!connectionString && (!connection || typeof connection !== 'object')) {
    throw inputError('connectionString or connection is required');
  }

  const base = connectionString
    ? { connectionString: String(connectionString) }
    : { ...connection };

  return {
    ...base,
    application_name: String(applicationName || 'kairoseth-puente-verifactu-local-agent'),
    connectionTimeoutMillis: connectionTimeoutMs,
  };
}

function normalizePgError(error, stage) {
  if (error?.code?.startsWith?.('VF_LOCAL_AGENT_')) return error;

  const retryableCodes = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
    '57P01',
    '57P02',
    '57P03',
    '08000',
    '08001',
    '08003',
    '08006',
  ]);

  const code = String(error?.code ?? '');
  return Object.assign(
    new Error(stage === 'connect' ? 'PostgreSQL connection failed' : 'PostgreSQL read-only query failed'),
    {
      code: stage === 'connect'
        ? 'VF_LOCAL_AGENT_POSTGRES_CONNECTION_FAILED'
        : 'VF_LOCAL_AGENT_POSTGRES_QUERY_FAILED',
      retryable: retryableCodes.has(code),
      databaseCode: code || null,
      cause: error,
    },
  );
}

async function withClient({ pgModule, clientConfig }, operation) {
  const module = await resolvePgModule(pgModule);
  const Client = getClientConstructor(module);
  const client = new Client(clientConfig);

  try {
    try {
      await client.connect();
    } catch (error) {
      throw normalizePgError(error, 'connect');
    }
    return await operation(client);
  } finally {
    try {
      await client.end();
    } catch {}
  }
}

async function beginReadOnly(client, statementTimeoutMs) {
  await client.query('BEGIN READ ONLY');
  await client.query(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch {}
}

export function createPostgresReadOnlyDriver({
  connectionString = null,
  connection = null,
  pgModule = null,
  applicationName = 'kairoseth-puente-verifactu-local-agent',
  connectionTimeoutMs = 5_000,
  statementTimeoutMs = 10_000,
} = {}) {
  const connectTimeout = normalizePositiveInteger(connectionTimeoutMs, 5_000, 'connectionTimeoutMs');
  const statementTimeout = normalizePositiveInteger(statementTimeoutMs, 10_000, 'statementTimeoutMs');
  const clientConfig = normalizeConnection({
    connectionString,
    connection,
    applicationName,
    connectionTimeoutMs: connectTimeout,
  });

  return createReadOnlyDatabaseDriver({
    dialect: 'postgresql',

    async verifyReadOnly() {
      return withClient({ pgModule, clientConfig }, async (client) => {
        try {
          await beginReadOnly(client, statementTimeout);
          const result = await client.query('SHOW transaction_read_only');
          const value = String(result?.rows?.[0]?.transaction_read_only ?? '').toLowerCase();
          await client.query('ROLLBACK');
          return value === 'on';
        } catch (error) {
          await rollbackQuietly(client);
          throw normalizePgError(error, 'query');
        }
      });
    },

    async fetchPage({ query, cursor, limit }) {
      const sql = assertReadOnlySelect(query);
      const pageLimit = normalizePositiveInteger(limit, 100, 'limit', 1_000);

      return withClient({ pgModule, clientConfig }, async (client) => {
        try {
          await beginReadOnly(client, statementTimeout);
          const result = await client.query({
            text: sql,
            values: [cursor, pageLimit],
          });
          if (result?.command && String(result.command).toUpperCase() !== 'SELECT') {
            throw inputError(
              'PostgreSQL driver received a non-SELECT result',
              'VF_LOCAL_AGENT_POSTGRES_NON_SELECT_RESULT',
            );
          }
          await client.query('COMMIT');
          return Array.isArray(result?.rows) ? result.rows : [];
        } catch (error) {
          await rollbackQuietly(client);
          throw normalizePgError(error, 'query');
        }
      });
    },
  });
}
