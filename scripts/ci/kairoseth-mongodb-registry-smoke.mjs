import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { hashBearerToken } from '../../apps/server/src/auth.mjs';
import { createPuenteRuntime } from '../../apps/server/src/runtime.mjs';
import {
  createMongoKairosethLocalAgentRegistryStore,
  mongoLocalAgentRegistryIndexes,
} from '../../packages/kairoseth-control-plane/src/mongodb-local-agent-registry.mjs';

const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018';
const client = new MongoClient(uri);
const databaseName = 'kairoseth_control_plane_smoke';
const collectionName = 'kairoseth_local_agent_installations_smoke';
const manageToken = 'kairoseth-mongodb-registry-manager';

function authConfig() {
  return {
    credentials: [{
      id: 'kairoseth-agent-manager-mongodb',
      type: 'bearer',
      tokenSha256: hashBearerToken(manageToken),
      organizationId: 'kairoseth-control',
      installationId: 'control-plane',
      sourceSystem: 'kairoseth',
      rateLimitPerMinute: 1000,
      permissions: ['agents:manage'],
    }],
  };
}

async function listen(runtime) {
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(0, '127.0.0.1', () => {
      runtime.server.off('error', reject);
      resolve();
    });
  });
  const address = runtime.server.address();
  return 'http://127.0.0.1:' + address.port;
}

async function request(baseUrl, path, { method = 'GET', token = manageToken, body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      authorization: 'Bearer ' + token,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  return { response, payload };
}

await client.connect();
const database = client.db(databaseName);
await database.dropDatabase();

const before = await database.listCollections({ name: collectionName }, { nameOnly: true }).toArray();
assert.equal(before.length, 0);

const registry = createMongoKairosethLocalAgentRegistryStore({ database, collectionName });

const afterConstructor = await database.listCollections({ name: collectionName }, { nameOnly: true }).toArray();
assert.equal(afterConstructor.length, 0, 'adapter constructor must not create MongoDB infrastructure');

await database.createCollection(collectionName);
await database.collection(collectionName).createIndexes(
  mongoLocalAgentRegistryIndexes().map((index) => ({
    key: { ...index.key },
    name: index.name,
    ...(index.unique ? { unique: true } : {}),
  })),
);

const nowRef = { value: Date.UTC(2026, 9, 3, 21, 0, 0) };
const createRuntime = async () => {
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    observabilityClock: () => nowRef.value,
    localAgentRegistryStore: registry,
  });
  return { runtime, baseUrl: await listen(runtime) };
};

try {
  const first = await createRuntime();
  const provision = await request(first.baseUrl, '/v1/control-plane/local-agents', {
    method: 'POST',
    body: {
      organizationId: 'org-mongo-001',
      installationId: 'erp-edge-01',
      sourceSystem: 'erp-kairoseth',
      label: 'ERP edge Hostinger',
      updatePolicy: 'manual',
    },
  });
  assert.equal(provision.response.status, 201);
  const tokenOne = provision.payload.credential.token;
  assert.match(tokenOne, /^pvla_/);

  const doc = await database.collection(collectionName).findOne({
    organizationId: 'org-mongo-001',
    installationId: 'erp-edge-01',
  });
  assert.ok(doc);
  assert.equal(doc.tokenSha256, createHash('sha256').update(tokenOne).digest('hex'));
  assert.equal(Object.prototype.hasOwnProperty.call(doc, 'token'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(doc, 'password'), false);

  const heartbeat = await request(first.baseUrl, '/v1/local-agent/heartbeat', {
    method: 'POST',
    token: tokenOne,
    body: {
      agentVersion: '0.1.0',
      platform: 'linux',
      arch: 'x64',
      sourceKind: 'database',
      status: 'ok',
      queue: { total: 2, pending: 1, processing: 0, completed: 1, blocked: 0, due: 1, expired: 0 },
    },
  });
  assert.equal(heartbeat.response.status, 200);
  assert.equal(heartbeat.payload.installation.queue.pending, 1);
  await first.runtime.close();

  const second = await createRuntime();
  try {
    const listed = await request(second.baseUrl, '/v1/control-plane/local-agents');
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.installations.length, 1);
    assert.equal(listed.payload.installations[0].organizationId, 'org-mongo-001');
    assert.equal('tokenSha256' in listed.payload.installations[0], false);

    const rotate = await request(second.baseUrl, '/v1/control-plane/local-agents/rotate-credential', {
      method: 'POST',
      body: { organizationId: 'org-mongo-001', installationId: 'erp-edge-01' },
    });
    assert.equal(rotate.response.status, 200);
    const tokenTwo = rotate.payload.credential.token;
    assert.notEqual(tokenTwo, tokenOne);

    const oldToken = await request(second.baseUrl, '/v1/local-agent/heartbeat', {
      method: 'POST',
      token: tokenOne,
      body: { agentVersion: '0.1.0', platform: 'linux', arch: 'x64', sourceKind: 'database', queue: {} },
    });
    assert.equal(oldToken.response.status, 401);

    const newToken = await request(second.baseUrl, '/v1/local-agent/heartbeat', {
      method: 'POST',
      token: tokenTwo,
      body: { agentVersion: '0.1.0', platform: 'linux', arch: 'x64', sourceKind: 'database', queue: {} },
    });
    assert.equal(newToken.response.status, 200);

    const revoke = await request(second.baseUrl, '/v1/control-plane/local-agents/revoke', {
      method: 'POST',
      body: { organizationId: 'org-mongo-001', installationId: 'erp-edge-01' },
    });
    assert.equal(revoke.response.status, 200);

    const revoked = await request(second.baseUrl, '/v1/local-agent/heartbeat', {
      method: 'POST',
      token: tokenTwo,
      body: { agentVersion: '0.1.0', platform: 'linux', arch: 'x64', sourceKind: 'database', queue: {} },
    });
    assert.equal(revoked.response.status, 401);
  } finally {
    await second.runtime.close();
  }

  const indexes = await database.collection(collectionName).indexes();
  assert.ok(indexes.some((index) => index.name === 'local_agent_tenant_installation_unique' && index.unique));
  assert.ok(indexes.some((index) => index.name === 'local_agent_token_sha256_unique' && index.unique));

  console.log(JSON.stringify({
    schema_version: 1,
    status: 'ok',
    check: 'kairoseth-hostinger-mongodb-registry',
    hostinger_boundary: true,
    mongodb: true,
    injected_database: true,
    automatic_collection_creation: false,
    cleartext_agent_token_persisted: false,
    runtime_restart_persistence: true,
  }, null, 2));
} finally {
  await database.dropDatabase().catch(() => {});
  await client.close();
}
