import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadLocalAgentConfig,
  resolveLocalAgentSecrets,
  validateLocalAgentConfig,
} from '../src/config.mjs';

function baseConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    installationId: 'test-installation',
    dataDir: './data',
    bridge: {
      baseUrl: 'https://bridge.example',
      apiKeyEnv: 'PV_LOCAL_AGENT_API_KEY',
    },
    source: {
      kind: 'watch-folder',
      sourceId: 'watch',
      profileId: 'watch-profile',
      root: './files',
      issueEnabled: false,
    },
    ...overrides,
  };
}

test('Local Agent config resolves paths and remains fail-closed by default', () => {
  const config = validateLocalAgentConfig(baseConfig(), { baseDir: '/tmp/pv-config' });
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.installationId, 'test-installation');
  assert.equal(config.dataDir, '/tmp/pv-config/data');
  assert.equal(config.source.root, '/tmp/pv-config/files');
  assert.equal(config.source.issueEnabled, false);
  assert.equal(config.runtime.pollIntervalMs, 5_000);
  assert.equal(config.runtime.workerBatchSize, 50);
});

test('Local Agent config forbids inline credentials and write-capable database SQL', () => {
  assert.throws(
    () => validateLocalAgentConfig(baseConfig({
      bridge: {
        baseUrl: 'https://bridge.example',
        apiKeyEnv: 'PV_LOCAL_AGENT_API_KEY',
        apiKey: 'must-not-live-here',
      },
    })),
    (error) => error.code === 'VF_LOCAL_AGENT_CONFIG_INLINE_SECRET_FORBIDDEN',
  );

  assert.throws(
    () => validateLocalAgentConfig(baseConfig({
      source: {
        kind: 'database',
        sourceId: 'erp-db',
        profileId: 'erp-profile',
        dialect: 'postgresql',
        cursorField: 'id',
        query: 'UPDATE invoices SET total = 0',
        connection: {
          host: 'db.internal',
          database: 'erp',
          user: 'reader',
          passwordEnv: 'PV_DB_PASSWORD',
        },
      },
    })),
    (error) => error.code === 'VF_LOCAL_AGENT_DB_QUERY_UNSAFE',
  );
});

test('Local Agent secrets are resolved from environment references only', async () => {
  const config = validateLocalAgentConfig(baseConfig({
    source: {
      kind: 'database',
      sourceId: 'erp-db',
      profileId: 'erp-profile',
      dialect: 'postgresql',
      cursorField: 'id',
      query: 'SELECT id FROM invoices WHERE id > $1 ORDER BY id ASC LIMIT $2',
      connection: {
        host: 'db.internal',
        database: 'erp',
        user: 'reader',
        passwordEnv: 'PV_DB_PASSWORD',
      },
    },
  }));

  assert.deepEqual(
    resolveLocalAgentSecrets(config, {
      PV_LOCAL_AGENT_API_KEY: 'bridge-secret',
      PV_DB_PASSWORD: 'database-secret',
    }),
    {
      bridgeApiKey: 'bridge-secret',
      databasePassword: 'database-secret',
    },
  );

  await assert.rejects(
    async () => resolveLocalAgentSecrets(config, { PV_LOCAL_AGENT_API_KEY: 'bridge-secret' }),
    (error) => error.code === 'VF_LOCAL_AGENT_SECRET_MISSING',
  );
});

test('config file permissions fail closed on POSIX', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permissions do not apply on Windows');
  const dir = await mkdtemp(join(tmpdir(), 'pv-local-agent-config-'));
  const path = join(dir, 'agent.json');
  await writeFile(path, JSON.stringify(baseConfig()), { mode: 0o644 });

  await assert.rejects(
    () => loadLocalAgentConfig(path),
    (error) => error.code === 'VF_LOCAL_AGENT_CONFIG_PERMISSIONS_UNSAFE',
  );

  await chmod(path, 0o600);
  const config = await loadLocalAgentConfig(path);
  assert.equal(config.installationId, 'test-installation');
});
