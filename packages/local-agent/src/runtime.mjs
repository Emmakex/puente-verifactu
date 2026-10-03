import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalAgentStore } from './store.mjs';
import { LocalAgentWorker, createPuenteApiTransport } from './worker.mjs';
import { createLocalAgentApiClient } from './client.mjs';
import {
  ensureWatchFolderLayout,
  ingestWatchFolder,
  recoverProcessingWatchFiles,
  settleWatchFolder,
} from './watch-ingest.mjs';
import { pollDatabaseSource } from './database-source.mjs';
import {
  createMysqlReadOnlyDriver,
  createPostgresReadOnlyDriver,
  createSqlServerReadOnlyDriver,
} from './database-drivers.mjs';
import { createSftpConnectionConfig, syncSftpSource } from './sftp-source.mjs';
import { resolveLocalAgentSecrets } from './config.mjs';

function fail(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details, retryable: false });
}

function errorSummary(error) {
  return Object.freeze({
    code: String(error?.code ?? 'VF_LOCAL_AGENT_RUNTIME_ERROR'),
    message: String(error?.message ?? 'Local Agent runtime error').slice(0, 300),
    retryable: Boolean(error?.retryable),
  });
}

async function defaultModuleLoader(specifier) {
  return import(specifier);
}

function constructorFrom(module, name) {
  const value = module?.[name] ?? module?.default?.[name] ?? (name === 'default' ? module?.default : null);
  if (typeof value !== 'function') {
    throw fail('VF_LOCAL_AGENT_DEPENDENCY_INVALID', `Optional runtime dependency does not expose ${name}`);
  }
  return value;
}

function functionFrom(module, name) {
  const value = module?.[name] ?? module?.default?.[name];
  if (typeof value !== 'function') {
    throw fail('VF_LOCAL_AGENT_DEPENDENCY_INVALID', `Optional runtime dependency does not expose ${name}()`);
  }
  return value;
}

async function ensurePrivateDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

async function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export async function acquireLocalAgentLock(dataDir) {
  await ensurePrivateDir(dataDir);
  const path = join(dataDir, 'agent.lock');
  const token = randomUUID();
  const payload = JSON.stringify({
    schemaVersion: 1,
    pid: process.pid,
    token,
    startedAt: new Date().toISOString(),
  }) + '\n';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(path, payload, { flag: 'wx', mode: 0o600 });
      return Object.freeze({
        path,
        async release() {
          try {
            const current = JSON.parse(await readFile(path, 'utf8'));
            if (current?.token === token) await unlink(path);
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
        },
      });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;

      let stale = true;
      try {
        const current = JSON.parse(await readFile(path, 'utf8'));
        stale = !(await processExists(Number(current?.pid)));
      } catch {}

      if (!stale) {
        throw fail('VF_LOCAL_AGENT_ALREADY_RUNNING', 'Another Local Agent process owns the runtime lock');
      }
      await unlink(path).catch((unlinkError) => {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError;
      });
    }
  }

  throw fail('VF_LOCAL_AGENT_LOCK_FAILED', 'Could not acquire Local Agent runtime lock');
}

async function bridgeReady(config, fetchImpl) {
  const response = await fetchImpl(`${config.bridge.baseUrl}/readyz`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok || body?.status !== 'ready') {
    throw Object.assign(new Error('Puente bridge is not ready'), {
      code: 'VF_LOCAL_AGENT_BRIDGE_NOT_READY',
      retryable: response.status >= 500,
      status: response.status,
    });
  }
  return Object.freeze({ ok: true, status: body.status });
}

async function buildDatabaseResource({ source, secrets, moduleLoader }) {
  const base = {
    host: source.connection.host,
    port: source.connection.port,
    user: source.connection.user,
    password: secrets.databasePassword,
    database: source.connection.database,
  };

  if (source.dialect === 'postgresql') {
    const pg = await moduleLoader('pg');
    const Pool = constructorFrom(pg, 'Pool');
    const pool = new Pool({
      ...base,
      ssl: source.connection.ssl ? { rejectUnauthorized: !source.connection.trustServerCertificate } : false,
      max: 2,
      min: 0,
    });
    return Object.freeze({
      driver: createPostgresReadOnlyDriver({ pool }),
      close: async () => pool.end(),
    });
  }

  if (source.dialect === 'mysql' || source.dialect === 'mariadb') {
    const mysql = await moduleLoader('mysql2/promise');
    const createPool = functionFrom(mysql, 'createPool');
    const pool = createPool({
      ...base,
      ssl: source.connection.ssl ? {} : undefined,
      connectionLimit: 2,
      multipleStatements: false,
    });
    return Object.freeze({
      driver: createMysqlReadOnlyDriver({ pool, dialect: source.dialect }),
      close: async () => pool.end(),
    });
  }

  const imported = await moduleLoader('mssql');
  const sql = imported?.default ?? imported;
  const ConnectionPool = constructorFrom(sql, 'ConnectionPool');
  const pool = await new ConnectionPool({
    server: base.host,
    port: base.port,
    user: base.user,
    password: base.password,
    database: base.database,
    options: {
      encrypt: source.connection.ssl,
      trustServerCertificate: source.connection.trustServerCertificate,
    },
    pool: { max: 2, min: 0 },
  }).connect();

  return Object.freeze({
    driver: createSqlServerReadOnlyDriver({ pool }),
    close: async () => pool.close(),
  });
}

async function readSftpPrivateKey(source) {
  return source.connection.privateKeyPath
    ? readFile(source.connection.privateKeyPath)
    : null;
}

function watchOptions(source, store) {
  return {
    store,
    root: source.root,
    sourceId: source.sourceId,
    profileId: source.profileId,
    issueEnabled: source.issueEnabled,
    minAgeMs: source.minAgeMs,
    maxFileBytes: source.maxFileBytes,
    maxRows: source.maxRows,
    ...(source.sheet == null ? {} : { sheet: source.sheet }),
    ...(source.headerRow == null ? {} : { headerRow: source.headerRow }),
  };
}

export class LocalAgentRuntime {
  constructor({
    config,
    env = process.env,
    fetchImpl = globalThis.fetch,
    moduleLoader = defaultModuleLoader,
    now = () => Date.now(),
    log = () => {},
  } = {}) {
    if (!config) throw new TypeError('config is required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
    if (typeof moduleLoader !== 'function') throw new TypeError('moduleLoader is required');
    if (typeof now !== 'function') throw new TypeError('now is required');
    if (typeof log !== 'function') throw new TypeError('log is required');

    this.config = config;
    this.env = env;
    this.secrets = resolveLocalAgentSecrets(config, env);
    this.fetchImpl = fetchImpl;
    this.moduleLoader = moduleLoader;
    this.now = now;
    this.log = log;
    this.databaseResource = null;
    this.closed = false;

    this.store = new LocalAgentStore(join(config.dataDir, 'agent.sqlite'));
    this.client = createLocalAgentApiClient({
      baseUrl: config.bridge.baseUrl,
      apiKey: this.secrets.bridgeApiKey,
      fetchImpl,
      allowInsecureLocalhost: config.bridge.allowInsecureLocalhost,
    });
    this.worker = new LocalAgentWorker({
      store: this.store,
      transport: createPuenteApiTransport(this.client),
      owner: `local-agent-${config.installationId}-${process.pid}`,
      leaseMs: config.runtime.leaseMs,
      maxAttempts: config.runtime.maxAttempts,
      now,
    });
  }

  emit(event, data = {}) {
    this.log(Object.freeze({
      schemaVersion: 1,
      timestamp: new Date(this.now()).toISOString(),
      event,
      installationId: this.config.installationId,
      sourceKind: this.config.source.kind,
      ...data,
    }));
  }

  async getDatabaseResource() {
    if (!this.databaseResource) {
      this.databaseResource = await buildDatabaseResource({
        source: this.config.source,
        secrets: this.secrets,
        moduleLoader: this.moduleLoader,
      });
    }
    return this.databaseResource;
  }

  async recoverFileSource() {
    const source = this.config.source;
    if (source.kind !== 'watch-folder' && source.kind !== 'sftp') return [];
    return recoverProcessingWatchFiles({
      ...watchOptions(source, this.store),
      now: this.now(),
    });
  }

  async ingestSource() {
    const source = this.config.source;

    if (source.kind === 'watch-folder') {
      return ingestWatchFolder({
        ...watchOptions(source, this.store),
        now: this.now(),
      });
    }

    if (source.kind === 'database') {
      const resource = await this.getDatabaseResource();
      return pollDatabaseSource({
        store: this.store,
        driver: resource.driver,
        sourceId: source.sourceId,
        profileId: source.profileId,
        cursorField: source.cursorField,
        query: source.query,
        initialCursor: source.initialCursor,
        pageSize: source.pageSize,
        issueEnabled: source.issueEnabled,
        now: this.now,
      });
    }

    const imported = await this.moduleLoader('ssh2-sftp-client');
    const SftpClient = constructorFrom(imported, 'default');
    const privateKey = await readSftpPrivateKey(source);
    const synced = await syncSftpSource({
      SftpClient,
      connection: {
        host: source.connection.host,
        port: source.connection.port,
        username: source.connection.username,
        password: this.secrets.sftpPassword,
        privateKey,
        passphrase: this.secrets.sftpPassphrase,
        hostKeySha256: source.connection.hostKeySha256,
        readyTimeout: source.connection.readyTimeout,
      },
      store: this.store,
      root: source.root,
      remoteDirectory: source.remoteDirectory,
      sourceId: source.sourceId,
      issueEnabled: source.issueEnabled,
      minAgeMs: source.minAgeMs,
      maxFileBytes: source.maxFileBytes,
      now: this.now(),
    });

    const ingested = await ingestWatchFolder({
      ...watchOptions(source, this.store),
      now: this.now(),
    });

    return Object.freeze({
      downloaded: synced.downloaded.length,
      remoteSkipped: synced.skipped.length,
      staged: ingested.staged.length,
      localSkipped: ingested.skipped.length,
    });
  }

  async runOnce() {
    if (this.closed) throw fail('VF_LOCAL_AGENT_RUNTIME_CLOSED', 'Local Agent runtime is closed');
    const now = this.now();
    const recoveredLeases = this.store.recoverExpired(now);
    const recoveredFiles = await this.recoverFileSource();
    const sourceResult = await this.ingestSource();
    const workerResult = await this.worker.runDue({ limit: this.config.runtime.workerBatchSize });

    let settled = null;
    if (this.config.source.kind === 'watch-folder' || this.config.source.kind === 'sftp') {
      settled = await settleWatchFolder({
        store: this.store,
        root: this.config.source.root,
      });
    }

    const redaction = this.store.redactTerminalPayloads({
      before: this.now() - this.config.runtime.terminalRedactionDelayMs,
      limit: 1_000,
    });
    const stats = this.store.stats(this.now());

    const summary = Object.freeze({
      recoveredLeases,
      recoveredFiles: recoveredFiles.length,
      source: this.config.source.kind,
      ingested: this.config.source.kind === 'database'
        ? Number(sourceResult?.queued ?? 0)
        : Number(sourceResult?.staged?.length ?? sourceResult?.staged ?? 0),
      processed: workerResult.processed,
      completed: workerResult.completed,
      pendingAfterWorker: workerResult.pending,
      blocked: workerResult.blocked,
      settled: settled?.settled?.length ?? 0,
      redacted: redaction.redacted,
      queue: stats,
    });
    this.emit('cycle.completed', summary);
    return summary;
  }

  status() {
    if (this.closed) throw fail('VF_LOCAL_AGENT_RUNTIME_CLOSED', 'Local Agent runtime is closed');
    return Object.freeze({
      schemaVersion: 1,
      installationId: this.config.installationId,
      sourceKind: this.config.source.kind,
      issueEnabled: this.config.source.issueEnabled,
      queue: this.store.stats(this.now()),
      checkpoint: this.config.source.kind === 'database'
        ? this.store.getCheckpoint(this.config.source.sourceId)
        : null,
    });
  }

  async doctor() {
    if (this.closed) throw fail('VF_LOCAL_AGENT_RUNTIME_CLOSED', 'Local Agent runtime is closed');
    const checks = [];

    try {
      const state = this.store.stats(this.now());
      checks.push({ name: 'local-store', ok: true, total: state.total });
    } catch (error) {
      checks.push({ name: 'local-store', ok: false, error: errorSummary(error) });
    }

    try {
      await bridgeReady(this.config, this.fetchImpl);
      checks.push({ name: 'bridge-ready', ok: true });
    } catch (error) {
      checks.push({ name: 'bridge-ready', ok: false, error: errorSummary(error) });
    }

    const source = this.config.source;
    try {
      if (source.kind === 'watch-folder') {
        await ensureWatchFolderLayout(source.root);
      } else if (source.kind === 'database') {
        const resource = await this.getDatabaseResource();
        await resource.driver.assertReadOnly();
      } else {
        const imported = await this.moduleLoader('ssh2-sftp-client');
        const SftpClient = constructorFrom(imported, 'default');
        const client = new SftpClient();
        const privateKey = await readSftpPrivateKey(source);
        await client.connect(createSftpConnectionConfig({
          host: source.connection.host,
          port: source.connection.port,
          username: source.connection.username,
          password: this.secrets.sftpPassword,
          privateKey,
          passphrase: this.secrets.sftpPassphrase,
          hostKeySha256: source.connection.hostKeySha256,
          readyTimeout: source.connection.readyTimeout,
        }));
        try {
          const entries = await client.list(source.remoteDirectory);
          if (!Array.isArray(entries)) throw fail('VF_LOCAL_AGENT_SFTP_PROTOCOL_INVALID', 'SFTP list() must return an array');
        } finally {
          await client.end();
        }
      }
      checks.push({ name: 'source-read-only', ok: true, kind: source.kind });
    } catch (error) {
      checks.push({ name: 'source-read-only', ok: false, kind: source.kind, error: errorSummary(error) });
    }

    const ok = checks.every((check) => check.ok === true);
    const result = Object.freeze({
      schemaVersion: 1,
      ok,
      installationId: this.config.installationId,
      sourceKind: source.kind,
      checks: Object.freeze(checks.map((check) => Object.freeze(check))),
    });
    this.emit('doctor.completed', { ok });
    return result;
  }

  async start({ signal, onCycle = () => {} } = {}) {
    if (typeof onCycle !== 'function') throw new TypeError('onCycle must be a function');
    this.emit('runtime.started', { pollIntervalMs: this.config.runtime.pollIntervalMs });

    while (!signal?.aborted) {
      try {
        onCycle(await this.runOnce());
      } catch (error) {
        this.emit('cycle.failed', { error: errorSummary(error) });
        onCycle(Object.freeze({ error: errorSummary(error) }));
      }
      if (signal?.aborted) break;
      try {
        await delay(this.config.runtime.pollIntervalMs, undefined, signal ? { signal } : undefined);
      } catch (error) {
        if (error?.name !== 'AbortError') throw error;
      }
    }
    this.emit('runtime.stopped');
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.databaseResource) await this.databaseResource.close();
    this.store.close();
  }
}

export function createLocalAgentRuntime(options) {
  return new LocalAgentRuntime(options);
}
