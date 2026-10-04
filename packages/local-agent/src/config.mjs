import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { assertOutboundBaseUrl } from './network.mjs';
import { assertReadOnlySelect, DATABASE_DIALECTS } from './database-source.mjs';

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const SOURCE_KINDS = new Set(['watch-folder', 'database', 'sftp']);
const FORBIDDEN_SECRET_KEYS = new Set([
  'apiKey',
  'password',
  'privateKey',
  'passphrase',
  'secret',
  'certificate',
  'aeatCertificate',
  'pfx',
  'privateKeyPem',
  'token',
  'bearerToken',
  'clientSecret',
]);

function fail(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details, retryable: false });
}

function text(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw fail('VF_LOCAL_AGENT_CONFIG_INVALID', `${name} is required`);
  return normalized;
}

function integer(value, fallback, { name, min, max }) {
  const normalized = Number(value ?? fallback);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw fail('VF_LOCAL_AGENT_CONFIG_INVALID', `${name} must be an integer between ${min} and ${max}`);
  }
  return normalized;
}

function boolean(value, fallback = false) {
  return value == null ? fallback : value === true;
}

function envName(value, name) {
  const normalized = text(value, name);
  if (!ENV_NAME.test(normalized)) {
    throw fail('VF_LOCAL_AGENT_CONFIG_INVALID', `${name} must be an uppercase environment variable name`);
  }
  return normalized;
}

function localPath(value, baseDir, name) {
  const normalized = text(value, name);
  return isAbsolute(normalized) ? resolve(normalized) : resolve(baseDir, normalized);
}

function rejectInlineSecrets(value, path = 'config') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) rejectInlineSecrets(value[index], `${path}[${index}]`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEYS.has(key)) {
      throw fail(
        'VF_LOCAL_AGENT_CONFIG_INLINE_SECRET_FORBIDDEN',
        `Inline secret field ${path}.${key} is forbidden; use an environment variable reference`,
      );
    }
    rejectInlineSecrets(child, `${path}.${key}`);
  }
}

function normalizeBridge(raw = {}) {
  const baseUrl = assertOutboundBaseUrl(text(raw.baseUrl, 'bridge.baseUrl'), {
    allowInsecureLocalhost: raw.allowInsecureLocalhost === true,
  });
  return Object.freeze({
    baseUrl,
    apiKeyEnv: envName(raw.apiKeyEnv, 'bridge.apiKeyEnv'),
    allowInsecureLocalhost: raw.allowInsecureLocalhost === true,
  });
}

function normalizeRuntime(raw = {}) {
  return Object.freeze({
    pollIntervalMs: integer(raw.pollIntervalMs, 5_000, {
      name: 'runtime.pollIntervalMs',
      min: 1_000,
      max: 300_000,
    }),
    heartbeatIntervalMs: integer(raw.heartbeatIntervalMs, 60_000, {
      name: 'runtime.heartbeatIntervalMs',
      min: 15_000,
      max: 15 * 60_000,
    }),
    workerBatchSize: integer(raw.workerBatchSize, 50, {
      name: 'runtime.workerBatchSize',
      min: 1,
      max: 1_000,
    }),
    leaseMs: integer(raw.leaseMs, 60_000, {
      name: 'runtime.leaseMs',
      min: 1_000,
      max: 15 * 60_000,
    }),
    maxAttempts: integer(raw.maxAttempts, 12, {
      name: 'runtime.maxAttempts',
      min: 1,
      max: 100,
    }),
    terminalRedactionDelayMs: integer(raw.terminalRedactionDelayMs, 0, {
      name: 'runtime.terminalRedactionDelayMs',
      min: 0,
      max: 7 * 24 * 60 * 60_000,
    }),
  });
}

function normalizeArchiveRetention(raw = null) {
  if (raw == null) {
    return Object.freeze({
      mode: 'keep',
      processedDays: null,
      errorDays: null,
    });
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail('VF_LOCAL_AGENT_CONFIG_INVALID', 'source.archiveRetention must be an object');
  }

  const mode = String(raw.mode ?? 'keep').trim().toLowerCase();
  if (mode === 'keep') {
    return Object.freeze({
      mode: 'keep',
      processedDays: null,
      errorDays: null,
    });
  }
  if (mode !== 'delete-source-after-days') {
    throw fail(
      'VF_LOCAL_AGENT_CONFIG_INVALID',
      'source.archiveRetention.mode must be keep or delete-source-after-days',
    );
  }

  return Object.freeze({
    mode,
    processedDays: integer(raw.processedDays, null, {
      name: 'source.archiveRetention.processedDays',
      min: 1,
      max: 3650,
    }),
    errorDays: integer(raw.errorDays, null, {
      name: 'source.archiveRetention.errorDays',
      min: 1,
      max: 3650,
    }),
  });
}

function normalizeWatchFolder(raw, baseDir) {
  return Object.freeze({
    kind: 'watch-folder',
    sourceId: text(raw.sourceId ?? 'watch-folder', 'source.sourceId'),
    profileId: text(raw.profileId, 'source.profileId'),
    root: localPath(raw.root, baseDir, 'source.root'),
    issueEnabled: boolean(raw.issueEnabled, false),
    minAgeMs: integer(raw.minAgeMs, 2_000, { name: 'source.minAgeMs', min: 0, max: 300_000 }),
    maxFileBytes: integer(raw.maxFileBytes, 5 * 1024 * 1024, {
      name: 'source.maxFileBytes',
      min: 1,
      max: 100 * 1024 * 1024,
    }),
    maxRows: integer(raw.maxRows, 10_000, { name: 'source.maxRows', min: 1, max: 100_000 }),
    sheet: raw.sheet == null ? null : String(raw.sheet),
    headerRow: raw.headerRow == null ? null : integer(raw.headerRow, null, {
      name: 'source.headerRow',
      min: 1,
      max: 10_000,
    }),
    archiveRetention: normalizeArchiveRetention(raw.archiveRetention),
  });
}

function normalizeDatabase(raw) {
  const dialect = text(raw.dialect, 'source.dialect').toLowerCase();
  if (!DATABASE_DIALECTS.includes(dialect)) {
    throw fail('VF_LOCAL_AGENT_CONFIG_INVALID', `Unsupported database dialect: ${dialect}`);
  }
  const connection = raw.connection;
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
    throw fail('VF_LOCAL_AGENT_CONFIG_INVALID', 'source.connection must be an object');
  }

  const normalizedConnection = Object.freeze({
    host: text(connection.host, 'source.connection.host'),
    port: integer(connection.port, dialect === 'postgresql' ? 5432 : dialect === 'sqlserver' ? 1433 : 3306, {
      name: 'source.connection.port',
      min: 1,
      max: 65535,
    }),
    database: text(connection.database, 'source.connection.database'),
    user: text(connection.user, 'source.connection.user'),
    passwordEnv: envName(connection.passwordEnv, 'source.connection.passwordEnv'),
    ssl: connection.ssl === true,
    trustServerCertificate: connection.trustServerCertificate === true,
  });

  return Object.freeze({
    kind: 'database',
    sourceId: text(raw.sourceId ?? `db-${dialect}`, 'source.sourceId'),
    profileId: text(raw.profileId, 'source.profileId'),
    issueEnabled: boolean(raw.issueEnabled, false),
    dialect,
    cursorField: text(raw.cursorField, 'source.cursorField'),
    query: assertReadOnlySelect(raw.query),
    initialCursor: raw.initialCursor ?? null,
    pageSize: integer(raw.pageSize, 100, { name: 'source.pageSize', min: 1, max: 1_000 }),
    connection: normalizedConnection,
  });
}

function normalizeSftp(raw, baseDir) {
  const connection = raw.connection;
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
    throw fail('VF_LOCAL_AGENT_CONFIG_INVALID', 'source.connection must be an object');
  }

  const passwordEnv = connection.passwordEnv == null
    ? null
    : envName(connection.passwordEnv, 'source.connection.passwordEnv');
  const privateKeyPath = connection.privateKeyPath == null
    ? null
    : localPath(connection.privateKeyPath, baseDir, 'source.connection.privateKeyPath');
  if (!passwordEnv && !privateKeyPath) {
    throw fail(
      'VF_LOCAL_AGENT_CONFIG_INVALID',
      'SFTP requires source.connection.passwordEnv or source.connection.privateKeyPath',
    );
  }

  return Object.freeze({
    kind: 'sftp',
    sourceId: text(raw.sourceId ?? 'sftp-drop-folder', 'source.sourceId'),
    profileId: text(raw.profileId, 'source.profileId'),
    root: localPath(raw.root, baseDir, 'source.root'),
    issueEnabled: boolean(raw.issueEnabled, false),
    remoteDirectory: text(raw.remoteDirectory, 'source.remoteDirectory'),
    minAgeMs: integer(raw.minAgeMs, 2_000, { name: 'source.minAgeMs', min: 0, max: 300_000 }),
    maxFileBytes: integer(raw.maxFileBytes, 5 * 1024 * 1024, {
      name: 'source.maxFileBytes',
      min: 1,
      max: 100 * 1024 * 1024,
    }),
    maxRows: integer(raw.maxRows, 10_000, { name: 'source.maxRows', min: 1, max: 100_000 }),
    sheet: raw.sheet == null ? null : String(raw.sheet),
    headerRow: raw.headerRow == null ? null : integer(raw.headerRow, null, {
      name: 'source.headerRow',
      min: 1,
      max: 10_000,
    }),
    archiveRetention: normalizeArchiveRetention(raw.archiveRetention),
    connection: Object.freeze({
      host: text(connection.host, 'source.connection.host'),
      port: integer(connection.port, 22, { name: 'source.connection.port', min: 1, max: 65535 }),
      username: text(connection.username, 'source.connection.username'),
      passwordEnv,
      privateKeyPath,
      passphraseEnv: connection.passphraseEnv == null
        ? null
        : envName(connection.passphraseEnv, 'source.connection.passphraseEnv'),
      hostKeySha256: text(connection.hostKeySha256, 'source.connection.hostKeySha256'),
      readyTimeout: integer(connection.readyTimeout, 20_000, {
        name: 'source.connection.readyTimeout',
        min: 1_000,
        max: 120_000,
      }),
    }),
  });
}

export function validateLocalAgentConfig(raw, { baseDir = process.cwd() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail('VF_LOCAL_AGENT_CONFIG_INVALID', 'Local Agent config must be an object');
  }
  rejectInlineSecrets(raw);
  if (Number(raw.schemaVersion) !== 1) {
    throw fail('VF_LOCAL_AGENT_CONFIG_VERSION_UNSUPPORTED', 'Local Agent config schemaVersion must be 1');
  }

  const sourceRaw = raw.source;
  if (!sourceRaw || typeof sourceRaw !== 'object' || Array.isArray(sourceRaw)) {
    throw fail('VF_LOCAL_AGENT_CONFIG_INVALID', 'source must be an object');
  }
  const kind = text(sourceRaw.kind, 'source.kind');
  if (!SOURCE_KINDS.has(kind)) {
    throw fail('VF_LOCAL_AGENT_CONFIG_INVALID', `Unsupported source.kind: ${kind}`);
  }

  const source = kind === 'watch-folder'
    ? normalizeWatchFolder(sourceRaw, baseDir)
    : kind === 'database'
      ? normalizeDatabase(sourceRaw)
      : normalizeSftp(sourceRaw, baseDir);

  return Object.freeze({
    schemaVersion: 1,
    installationId: text(raw.installationId, 'installationId'),
    dataDir: localPath(raw.dataDir, baseDir, 'dataDir'),
    bridge: normalizeBridge(raw.bridge),
    runtime: normalizeRuntime(raw.runtime),
    source,
  });
}

export async function loadLocalAgentConfig(path) {
  const resolved = resolve(text(path, 'config path'));
  const info = await stat(resolved);
  if (!info.isFile()) throw fail('VF_LOCAL_AGENT_CONFIG_INVALID', 'Local Agent config path must be a file');
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    throw fail(
      'VF_LOCAL_AGENT_CONFIG_PERMISSIONS_UNSAFE',
      'Local Agent config must not be readable or writable by group/others (use chmod 600)',
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(resolved, 'utf8'));
  } catch (error) {
    throw fail('VF_LOCAL_AGENT_CONFIG_INVALID_JSON', 'Local Agent config is not valid JSON', {
      cause: String(error?.message ?? error),
    });
  }
  return validateLocalAgentConfig(parsed, { baseDir: dirname(resolved) });
}

function requiredEnv(env, name, label) {
  const value = String(env?.[name] ?? '');
  if (!value) {
    throw fail('VF_LOCAL_AGENT_SECRET_MISSING', `${label} environment variable ${name} is required`);
  }
  return value;
}

export function resolveLocalAgentSecrets(config, env = process.env) {
  const bridgeApiKey = requiredEnv(env, config.bridge.apiKeyEnv, 'Bridge API key');
  const source = config.source;

  if (source.kind === 'database') {
    return Object.freeze({
      bridgeApiKey,
      databasePassword: requiredEnv(env, source.connection.passwordEnv, 'Database password'),
    });
  }

  if (source.kind === 'sftp') {
    return Object.freeze({
      bridgeApiKey,
      sftpPassword: source.connection.passwordEnv
        ? requiredEnv(env, source.connection.passwordEnv, 'SFTP password')
        : null,
      sftpPassphrase: source.connection.passphraseEnv
        ? requiredEnv(env, source.connection.passphraseEnv, 'SFTP key passphrase')
        : null,
    });
  }

  return Object.freeze({ bridgeApiKey });
}
