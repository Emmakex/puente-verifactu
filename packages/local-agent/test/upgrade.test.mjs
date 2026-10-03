import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LocalAgentStore } from '../src/store.mjs';
import { acquireLocalAgentLock } from '../src/runtime.mjs';
import {
  assertUpgradeNode,
  createLocalAgentStateBackup,
  inspectLocalAgentState,
  prepareLocalAgentUpgrade,
} from '../src/upgrade.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pv-local-agent-upgrade-'));
  const dataDir = join(root, 'data');
  const configPath = join(root, 'agent.json');
  const manifestPath = join(root, 'bundle-manifest.json');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });

  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    installationId: 'upgrade-test',
    dataDir,
    bridge: {
      baseUrl: 'https://bridge.example',
      apiKeyEnv: 'PV_LOCAL_AGENT_API_KEY',
    },
    source: {
      kind: 'watch-folder',
      sourceId: 'upgrade-watch',
      profileId: 'upgrade-profile',
      root: join(root, 'watch'),
      issueEnabled: false,
    },
  }, null, 2) + '\n', { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(configPath, 0o600);

  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    product: 'kairoseth-fiscal',
    component: 'local-agent',
    artifactKind: 'portable-source',
    version: '0.1.0',
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    requiredNode: '>=22.13.0',
    upgradeRequiredNode: '>=22.16.0',
    stateCompatibility: {
      current: 1,
      minReadable: 1,
      maxReadable: 1,
      backupRequired: true,
      automaticDatabaseRollback: false,
    },
  }, null, 2) + '\n');

  return { root, dataDir, configPath, manifestPath, dbPath: join(dataDir, 'agent.sqlite') };
}

test('Local Agent store stamps SQLite state schema version 1', async () => {
  const { dbPath } = await fixture();
  const store = new LocalAgentStore(dbPath);
  store.enqueue({
    sourceId: 'test',
    sourceKey: 'one',
    payload: { kind: 'mapped-source', profileId: 'p', source: { id: 1 } },
  });
  store.close();

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), 1);
  } finally {
    db.close();
  }
});

test('legacy Local Agent state with user_version 0 is recognized as schema 1 and can be backed up', async () => {
  const { root, dbPath } = await fixture();
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE local_agent_jobs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_fingerprint TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      available_at_ms INTEGER NOT NULL,
      lease_owner TEXT,
      lease_until_ms INTEGER,
      record_id TEXT,
      result_json TEXT,
      error_json TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    INSERT INTO local_agent_jobs VALUES (
      'job-1', 'source', 'key', '{}', 'fp', 'idem', 'pending', 0, 0,
      NULL, NULL, NULL, NULL, NULL, 0, 0
    );
  `);
  db.close();

  const state = await inspectLocalAgentState(dbPath);
  assert.equal(state.exists, true);
  assert.equal(state.stateSchema, 1);
  assert.equal(state.legacyUserVersion, true);
  assert.equal(state.counts.jobs, 1);

  const backup = await createLocalAgentStateBackup({
    dbPath,
    backupDir: join(root, 'backups'),
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    now: Date.UTC(2026, 9, 3, 18, 0, 0),
  });

  assert.equal(backup.created, true);
  assert.equal(backup.verified, true);
  assert.equal(backup.stateSchema, 1);
  assert.equal(backup.counts.jobs, 1);
  assert.match(backup.sha256, /^[0-9a-f]{64}$/);
  assert.equal((await stat(backup.backupPath)).isFile(), true);
  if (process.platform !== 'win32') {
    assert.equal((await stat(backup.backupPath)).mode & 0o777, 0o600);
  }

  const backupState = await inspectLocalAgentState(backup.backupPath);
  assert.equal(backupState.counts.jobs, 1);
});

test('prepare upgrade is fail-closed, creates verified backup and declares code-only rollback', async () => {
  const { dataDir, configPath, manifestPath, dbPath } = await fixture();
  const store = new LocalAgentStore(dbPath);
  store.enqueue({
    sourceId: 'orders',
    sourceKey: '42',
    payload: { kind: 'mapped-source', profileId: 'orders-v1', source: { id: 42 } },
  });
  store.close();

  const result = await prepareLocalAgentUpgrade({
    manifestPath,
    configPath,
    now: Date.UTC(2026, 9, 3, 18, 5, 0),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.state.stateSchema, 1);
  assert.equal(result.backup.created, true);
  assert.equal(result.backup.verified, true);
  assert.equal(result.backup.counts.jobs, 1);
  assert.equal(result.automaticDatabaseRollback, false);
  assert.equal(result.rollbackPolicy, 'code-only');
  assert.ok(result.backup.backupPath.startsWith(join(dataDir, 'backups')));
});

test('prepare upgrade rejects a newer SQLite state schema before activation', async () => {
  const { configPath, manifestPath, dbPath } = await fixture();
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE local_agent_jobs (id TEXT PRIMARY KEY); PRAGMA user_version = 2;');
  db.close();

  await assert.rejects(
    () => prepareLocalAgentUpgrade({ manifestPath, configPath }),
    (error) => error.code === 'VF_LOCAL_AGENT_STATE_SCHEMA_INCOMPATIBLE'
      && error.details.installed === 2,
  );
});

test('prepare upgrade refuses to run while another Local Agent owns the data-dir lock', async () => {
  const { dataDir, configPath, manifestPath, dbPath } = await fixture();
  const store = new LocalAgentStore(dbPath);
  store.close();

  const lock = await acquireLocalAgentLock(dataDir);
  try {
    await assert.rejects(
      () => prepareLocalAgentUpgrade({ manifestPath, configPath }),
      (error) => error.code === 'VF_LOCAL_AGENT_ALREADY_RUNNING',
    );
  } finally {
    await lock.release();
  }
});

test('upgrade guard rejects Node runtimes older than sqlite.backup support', () => {
  assert.throws(
    () => assertUpgradeNode('22.15.9'),
    (error) => error.code === 'VF_LOCAL_AGENT_UPGRADE_NODE_UNSUPPORTED',
  );
  assert.equal(assertUpgradeNode('22.16.0'), true);
  assert.equal(assertUpgradeNode('24.0.0'), true);
});

test('backup is a verified snapshot and never rewrites the source database', async () => {
  const { root, dbPath } = await fixture();
  const store = new LocalAgentStore(dbPath);
  store.enqueue({
    sourceId: 'source',
    sourceKey: 'immutable',
    payload: { kind: 'mapped-source', profileId: 'p', source: { value: 'before' } },
  });
  store.close();

  const before = await readFile(dbPath);
  const backup = await createLocalAgentStateBackup({
    dbPath,
    backupDir: join(root, 'backups'),
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
  });
  const after = await readFile(dbPath);

  assert.deepEqual(after, before);
  assert.equal(backup.created, true);
});
