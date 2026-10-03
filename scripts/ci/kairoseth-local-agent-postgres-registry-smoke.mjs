import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { hashBearerToken } from '../../apps/server/src/auth.mjs';
import { createPuenteRuntime } from '../../apps/server/src/runtime.mjs';
import { createPostgresKairosethLocalAgentRegistryStore, postgresLocalAgentRegistryMigrationSql } from '../../packages/kairoseth-control-plane/src/postgres-local-agent-registry.mjs';

const { Pool } = pg;
const tableName = 'public.kairoseth_local_agent_installations_smoke';
const table = 'kairoseth_local_agent_installations_smoke';
const manageToken = 'kairoseth-postgres-registry-manager';
const pool = new Pool({ host: process.env.DB_HOST ?? '127.0.0.1', port: Number(process.env.DB_PORT ?? 55432), user: process.env.DB_USER ?? 'postgres', password: process.env.DB_PASSWORD ?? 'root', database: process.env.DB_NAME ?? 'postgres', max: 4 });
const registry = createPostgresKairosethLocalAgentRegistryStore({ pool, tableName });

function authConfig() {
  return { credentials: [{ id: 'kairoseth-agent-manager-postgres', type: 'bearer', tokenSha256: hashBearerToken(manageToken), organizationId: 'kairoseth-control', installationId: 'control-plane', sourceSystem: 'kairoseth', rateLimitPerMinute: 1000, permissions: ['agents:manage'] }] };
}

async function listen(runtime) {
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(0, '127.0.0.1', () => { runtime.server.off('error', reject); resolve(); });
  });
  const address = runtime.server.address();
  return 'http://127.0.0.1:' + address.port;
}

async function request(baseUrl, path, { method = 'GET', token = manageToken, body } = {}) {
  const response = await fetch(baseUrl + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let payload = null;
  try { payload = await response.json(); } catch {}
  return { response, payload };
}

async function runtimeWithRegistry(nowRef) {
  const runtime = createPuenteRuntime({ databasePath: ':memory:', authConfig: authConfig(), sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' }, observabilityClock: () => nowRef.value, localAgentRegistryStore: registry });
  return { runtime, baseUrl: await listen(runtime) };
}

try {
  await pool.query('DROP TABLE IF EXISTS "' + table + '"');
  const before = await pool.query('SELECT to_regclass($1) AS relation', [tableName]);
  assert.equal(before.rows[0].relation, null, 'adapter must not auto-create Kairoseth tables');
  await pool.query(postgresLocalAgentRegistryMigrationSql({ tableName }));
  const afterMigration = await pool.query('SELECT to_regclass($1) AS relation', [tableName]);
  assert.equal(afterMigration.rows[0].relation, tableName);

  const nowRef = { value: Date.UTC(2026, 9, 3, 20, 0, 0) };
  const first = await runtimeWithRegistry(nowRef);
  const provision = await request(first.baseUrl, '/v1/control-plane/local-agents', { method: 'POST', body: { organizationId: 'org-postgres-001', installationId: 'erp-edge-01', sourceSystem: 'erp-kairoseth', label: 'ERP PostgreSQL edge', updatePolicy: 'manual' } });
  assert.equal(provision.response.status, 201);
  const tokenOne = provision.payload.credential.token;
  assert.match(tokenOne, /^pvla_/);

  const stored = await pool.query('SELECT token_sha256 FROM "' + table + '" WHERE organization_id = $1 AND installation_id = $2', ['org-postgres-001', 'erp-edge-01']);
  assert.equal(stored.rows[0].token_sha256, createHash('sha256').update(tokenOne).digest('hex'));
  assert.notEqual(stored.rows[0].token_sha256, tokenOne);

  const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [table]);
  const columnNames = columns.rows.map((row) => row.column_name);
  assert.equal(columnNames.includes('token'), false);
  assert.equal(columnNames.includes('password'), false);
  assert.equal(columnNames.includes('token_sha256'), true);

  const heartbeat = await request(first.baseUrl, '/v1/local-agent/heartbeat', { method: 'POST', token: tokenOne, body: { agentVersion: '0.1.0', platform: 'linux', arch: 'x64', sourceKind: 'database', status: 'ok', queue: { total: 4, pending: 2, processing: 0, completed: 2, blocked: 0, due: 2, expired: 0 } } });
  assert.equal(heartbeat.response.status, 200);
  assert.equal(heartbeat.payload.installation.organizationId, 'org-postgres-001');
  assert.equal(heartbeat.payload.control.autoUpdate, false);
  await first.runtime.close();

  const second = await runtimeWithRegistry(nowRef);
  try {
    const list = await request(second.baseUrl, '/v1/control-plane/local-agents');
    assert.equal(list.response.status, 200);
    assert.equal(list.payload.installations.length, 1);
    assert.equal(list.payload.installations[0].queue.pending, 2);
    assert.equal('tokenSha256' in list.payload.installations[0], false);

    const control = await request(second.baseUrl, '/v1/control-plane/local-agents', { method: 'PATCH', body: { organizationId: 'org-postgres-001', installationId: 'erp-edge-01', desiredVersion: '0.2.0', updatePolicy: 'manual' } });
    assert.equal(control.response.status, 200);
    assert.equal(control.payload.desiredVersion, '0.2.0');

    const rotate = await request(second.baseUrl, '/v1/control-plane/local-agents/rotate-credential', { method: 'POST', body: { organizationId: 'org-postgres-001', installationId: 'erp-edge-01' } });
    assert.equal(rotate.response.status, 200);
    const tokenTwo = rotate.payload.credential.token;
    assert.notEqual(tokenTwo, tokenOne);

    const oldToken = await request(second.baseUrl, '/v1/local-agent/heartbeat', { method: 'POST', token: tokenOne, body: { agentVersion: '0.1.0', platform: 'linux', arch: 'x64', sourceKind: 'database', queue: {} } });
    assert.equal(oldToken.response.status, 401);
    const newToken = await request(second.baseUrl, '/v1/local-agent/heartbeat', { method: 'POST', token: tokenTwo, body: { agentVersion: '0.1.0', platform: 'linux', arch: 'x64', sourceKind: 'database', queue: {} } });
    assert.equal(newToken.response.status, 200);
    assert.equal(newToken.payload.control.desiredVersion, '0.2.0');

    const revoke = await request(second.baseUrl, '/v1/control-plane/local-agents/revoke', { method: 'POST', body: { organizationId: 'org-postgres-001', installationId: 'erp-edge-01' } });
    assert.equal(revoke.response.status, 200);
    const revoked = await request(second.baseUrl, '/v1/local-agent/heartbeat', { method: 'POST', token: tokenTwo, body: { agentVersion: '0.1.0', platform: 'linux', arch: 'x64', sourceKind: 'database', queue: {} } });
    assert.equal(revoked.response.status, 401);
  } finally { await second.runtime.close(); }

  console.log(JSON.stringify({ schema_version: 1, status: 'ok', check: 'kairoseth-local-agent-postgres-registry', postgres: '16', injected_pool: true, automatic_migration: false, cleartext_agent_token_persisted: false, runtime_restart_persistence: true, tenant_identity_server_authoritative: true }, null, 2));
} finally {
  await pool.query('DROP TABLE IF EXISTS "' + table + '"').catch(() => {});
  await pool.end();
}
