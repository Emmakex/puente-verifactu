import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { loadLocalAgentConfig } from './config.mjs';
import { acquireLocalAgentLock } from './runtime.mjs';

export const LOCAL_AGENT_STATE_SCHEMA = 1;
export const LOCAL_AGENT_UPGRADE_MIN_NODE = '22.16.0';

function fail(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details, retryable: false });
}

function parseNodeVersion(value) {
  const match = String(value ?? '').trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw fail('VF_LOCAL_AGENT_UPGRADE_NODE_INVALID', 'Could not parse Node.js version');
  return match.slice(1).map(Number);
}

function versionAtLeast(current, minimum) {
  const a = parseNodeVersion(current);
  const b = parseNodeVersion(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return true;
    if (a[index] < b[index]) return false;
  }
  return true;
}

export function assertUpgradeNode(nodeVersion = process.versions.node) {
  if (!versionAtLeast(nodeVersion, LOCAL_AGENT_UPGRADE_MIN_NODE)) {
    throw fail(
      'VF_LOCAL_AGENT_UPGRADE_NODE_UNSUPPORTED',
      `Local Agent upgrade requires Node.js >=${LOCAL_AGENT_UPGRADE_MIN_NODE}`,
      { current: String(nodeVersion), required: LOCAL_AGENT_UPGRADE_MIN_NODE },
    );
  }
  return true;
}

function normalizeCompatibility(manifest) {
  const compatibility = manifest?.stateCompatibility;
  if (!compatibility || typeof compatibility !== 'object') {
    throw fail('VF_LOCAL_AGENT_UPGRADE_MANIFEST_INVALID', 'Bundle stateCompatibility is required');
  }

  const current = Number(compatibility.current);
  const minReadable = Number(compatibility.minReadable);
  const maxReadable = Number(compatibility.maxReadable);

  if (
    !Number.isInteger(current)
    || !Number.isInteger(minReadable)
    || !Number.isInteger(maxReadable)
    || current < 1
    || minReadable < 1
    || maxReadable < minReadable
    || current < minReadable
    || current > maxReadable
  ) {
    throw fail('VF_LOCAL_AGENT_UPGRADE_MANIFEST_INVALID', 'Bundle stateCompatibility is invalid');
  }
  if (compatibility.backupRequired !== true || compatibility.automaticDatabaseRollback !== false) {
    throw fail(
      'VF_LOCAL_AGENT_UPGRADE_MANIFEST_INVALID',
      'Bundle must require a backup and forbid automatic database rollback',
    );
  }

  return Object.freeze({
    current,
    minReadable,
    maxReadable,
    backupRequired: true,
    automaticDatabaseRollback: false,
  });
}

export async function readLocalAgentBundleManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(resolve(path), 'utf8'));
  } catch (error) {
    throw fail('VF_LOCAL_AGENT_UPGRADE_MANIFEST_INVALID', 'Could not read bundle manifest', {
      cause: String(error?.message ?? error),
    });
  }
  if (
    manifest?.schemaVersion !== 1
    || manifest?.product !== 'kairoseth-fiscal'
    || manifest?.component !== 'local-agent'
    || !/^[0-9a-f]{40}$/.test(String(manifest?.sourceCommit ?? ''))
  ) {
    throw fail('VF_LOCAL_AGENT_UPGRADE_MANIFEST_INVALID', 'Bundle manifest identity is invalid');
  }

  const upgradeRequiredNode = String(manifest?.upgradeRequiredNode ?? '').replace(/^>=/, '');
  if (!upgradeRequiredNode) {
    throw fail('VF_LOCAL_AGENT_UPGRADE_MANIFEST_INVALID', 'Bundle upgradeRequiredNode is required');
  }

  return Object.freeze({
    ...manifest,
    stateCompatibility: normalizeCompatibility(manifest),
    upgradeRequiredNode: String(manifest.upgradeRequiredNode),
  });
}

async function sqliteModule() {
  assertUpgradeNode();
  const sqlite = await import('node:sqlite');
  if (typeof sqlite.DatabaseSync !== 'function' || typeof sqlite.backup !== 'function') {
    throw fail(
      'VF_LOCAL_AGENT_UPGRADE_SQLITE_BACKUP_UNAVAILABLE',
      'This Node.js runtime does not provide the required SQLite backup API',
    );
  }
  return sqlite;
}

function quickCheck(db) {
  const rows = db.prepare('PRAGMA quick_check').all();
  return rows.length > 0 && rows.every((row) => Object.values(row).every((value) => value === 'ok'));
}

function tableExists(db, name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(name),
  );
}

function countIfExists(db, name) {
  if (!tableExists(db, name)) return null;
  const allowed = new Set([
    'local_agent_jobs',
    'local_agent_checkpoints',
    'local_agent_source_receipts',
  ]);
  if (!allowed.has(name)) return null;
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()?.count ?? 0);
}

function inspectOpenDatabase(db) {
  if (!quickCheck(db)) {
    throw fail('VF_LOCAL_AGENT_STATE_INTEGRITY_FAILED', 'Local Agent SQLite quick_check failed');
  }

  const userVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  const hasAgentJobs = tableExists(db, 'local_agent_jobs');
  const stateSchema = userVersion === 0 && hasAgentJobs
    ? 1
    : userVersion;

  if (stateSchema < 0 || !Number.isInteger(stateSchema)) {
    throw fail('VF_LOCAL_AGENT_STATE_SCHEMA_INVALID', 'Local Agent SQLite state schema is invalid');
  }

  return Object.freeze({
    stateSchema,
    legacyUserVersion: userVersion === 0 && hasAgentJobs,
    quickCheck: true,
    counts: Object.freeze({
      jobs: countIfExists(db, 'local_agent_jobs'),
      checkpoints: countIfExists(db, 'local_agent_checkpoints'),
      receipts: countIfExists(db, 'local_agent_source_receipts'),
    }),
  });
}

export async function inspectLocalAgentState(path) {
  const dbPath = resolve(path);
  try {
    const info = await stat(dbPath);
    if (!info.isFile()) {
      throw fail('VF_LOCAL_AGENT_STATE_INVALID', 'Local Agent SQLite path is not a file');
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return Object.freeze({
        exists: false,
        path: dbPath,
        stateSchema: null,
        legacyUserVersion: false,
        quickCheck: null,
        counts: null,
      });
    }
    throw error;
  }

  const { DatabaseSync } = await sqliteModule();
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5_000 });
  try {
    const inspection = inspectOpenDatabase(db);
    return Object.freeze({ exists: true, path: dbPath, ...inspection });
  } finally {
    db.close();
  }
}

function assertStateCompatible(state, compatibility) {
  if (!state.exists) return;
  if (
    state.stateSchema < compatibility.minReadable
    || state.stateSchema > compatibility.maxReadable
  ) {
    throw fail(
      'VF_LOCAL_AGENT_STATE_SCHEMA_INCOMPATIBLE',
      'Installed Local Agent SQLite state is not compatible with this bundle',
      {
        installed: state.stateSchema,
        minReadable: compatibility.minReadable,
        maxReadable: compatibility.maxReadable,
      },
    );
  }
}

function backupName(sourceCommit, now) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  return `agent-${stamp}-before-${sourceCommit.slice(0, 12)}.sqlite`;
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function createLocalAgentStateBackup({
  dbPath,
  backupDir,
  sourceCommit,
  now = Date.now(),
} = {}) {
  assertUpgradeNode();
  if (!/^[0-9a-f]{40}$/.test(String(sourceCommit ?? ''))) {
    throw fail('VF_LOCAL_AGENT_UPGRADE_INPUT_INVALID', 'sourceCommit must be a full SHA');
  }

  const before = await inspectLocalAgentState(dbPath);
  if (!before.exists) {
    return Object.freeze({
      created: false,
      reason: 'state_not_present',
      sourcePath: resolve(dbPath),
      backupPath: null,
    });
  }

  await mkdir(resolve(backupDir), { recursive: true, mode: 0o700 });
  const destination = join(resolve(backupDir), backupName(sourceCommit, Number(now)));
  const { DatabaseSync, backup } = await sqliteModule();
  const sourceDb = new DatabaseSync(resolve(dbPath), { readOnly: true, timeout: 5_000 });

  let pages;
  try {
    pages = await backup(sourceDb, destination, { rate: 100 });
  } catch (error) {
    throw fail('VF_LOCAL_AGENT_STATE_BACKUP_FAILED', 'Could not create Local Agent SQLite backup', {
      cause: String(error?.message ?? error),
    });
  } finally {
    sourceDb.close();
  }

  if (process.platform !== 'win32') await chmod(destination, 0o600);
  const after = await inspectLocalAgentState(destination);
  if (
    !after.exists
    || after.stateSchema !== before.stateSchema
    || JSON.stringify(after.counts) !== JSON.stringify(before.counts)
  ) {
    throw fail('VF_LOCAL_AGENT_STATE_BACKUP_VERIFY_FAILED', 'Local Agent SQLite backup verification failed');
  }

  return Object.freeze({
    created: true,
    sourcePath: before.path,
    backupPath: destination,
    backupFile: basename(destination),
    pages: Number(pages),
    sha256: await sha256File(destination),
    stateSchema: before.stateSchema,
    counts: before.counts,
    verified: true,
  });
}

export async function prepareLocalAgentUpgrade({
  manifestPath,
  configPath,
  backupDir = null,
  nodeVersion = process.versions.node,
  now = Date.now(),
} = {}) {
  assertUpgradeNode(nodeVersion);
  const manifest = await readLocalAgentBundleManifest(manifestPath);
  const required = String(manifest.upgradeRequiredNode).replace(/^>=/, '');
  if (!versionAtLeast(nodeVersion, required)) {
    throw fail(
      'VF_LOCAL_AGENT_UPGRADE_NODE_UNSUPPORTED',
      `Bundle upgrade requires Node.js ${manifest.upgradeRequiredNode}`,
      { current: String(nodeVersion), required: manifest.upgradeRequiredNode },
    );
  }

  const config = await loadLocalAgentConfig(configPath);
  const dbPath = join(config.dataDir, 'agent.sqlite');
  const lock = await acquireLocalAgentLock(config.dataDir);
  try {
    const state = await inspectLocalAgentState(dbPath);
    assertStateCompatible(state, manifest.stateCompatibility);

    const backups = backupDir == null
      ? join(config.dataDir, 'backups')
      : resolve(backupDir);
    const backup = await createLocalAgentStateBackup({
      dbPath,
      backupDir: backups,
      sourceCommit: manifest.sourceCommit,
      now,
    });

    return Object.freeze({
      schemaVersion: 1,
      status: 'ready',
      sourceCommit: manifest.sourceCommit,
      version: String(manifest.version),
      state,
      backup,
      automaticDatabaseRollback: false,
      rollbackPolicy: 'code-only',
    });
  } finally {
    await lock.release();
  }
}
