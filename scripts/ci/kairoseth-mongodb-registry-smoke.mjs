import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { hashBearerToken } from '../../apps/server/src/auth.mjs';
import { createPuenteRuntime } from '../../apps/server/src/runtime.mjs';
import {
  createMongoKairosethLocalAgentRegistryStore,
  mongoLocalAgentRegistryIndexes,
} from '../../packages/kairoseth-control-plane/src/mongodb-local-agent-registry.mjs';
import {
  createMongoKairosethOnboardingProfileStore,
  mongoOnboardingProfileIndexes,
} from '../../packages/kairoseth-control-plane/src/mongodb-onboarding-profiles.mjs';

const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018';
const client = new MongoClient(uri);
const databaseName = 'kairoseth_control_plane_smoke';
const collectionName = 'kairoseth_local_agent_installations_smoke';
const onboardingCollectionName = 'kairoseth_onboarding_profiles_smoke';
const manageToken = 'kairoseth-mongodb-registry-manager';
const onboardingToken = 'kairoseth-mongodb-onboarding-org';
const otherTenantToken = 'kairoseth-mongodb-onboarding-other';

function authConfig() {
  return {
    credentials: [
      {
        id: 'kairoseth-agent-manager-mongodb',
        type: 'bearer',
        tokenSha256: hashBearerToken(manageToken),
        organizationId: 'kairoseth-control',
        installationId: 'control-plane',
        sourceSystem: 'kairoseth',
        rateLimitPerMinute: 1000,
        permissions: ['agents:manage'],
      },
      {
        id: 'kairoseth-onboarding-mongodb',
        type: 'bearer',
        tokenSha256: hashBearerToken(onboardingToken),
        organizationId: 'org-mongo-001',
        installationId: 'kairoseth-ui',
        sourceSystem: 'kairoseth',
        rateLimitPerMinute: 1000,
        permissions: ['onboarding:manage'],
      },
      {
        id: 'kairoseth-onboarding-other',
        type: 'bearer',
        tokenSha256: hashBearerToken(otherTenantToken),
        organizationId: 'org-mongo-other',
        installationId: 'kairoseth-ui',
        sourceSystem: 'kairoseth',
        rateLimitPerMinute: 1000,
        permissions: ['onboarding:manage'],
      },
    ],
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

const before = await database.listCollections({}, { nameOnly: true }).toArray();
assert.equal(before.some((item) => item.name === collectionName), false);
assert.equal(before.some((item) => item.name === onboardingCollectionName), false);

const registry = createMongoKairosethLocalAgentRegistryStore({ database, collectionName });
const onboardingProfileStore = createMongoKairosethOnboardingProfileStore({
  database,
  collectionName: onboardingCollectionName,
});

const afterConstructor = await database.listCollections({}, { nameOnly: true }).toArray();
assert.equal(
  afterConstructor.some((item) => item.name === collectionName),
  false,
  'Local Agent adapter constructor must not create MongoDB infrastructure',
);
assert.equal(
  afterConstructor.some((item) => item.name === onboardingCollectionName),
  false,
  'Onboarding adapter constructor must not create MongoDB infrastructure',
);

await database.createCollection(collectionName);
await database.collection(collectionName).createIndexes(
  mongoLocalAgentRegistryIndexes().map((index) => ({
    key: { ...index.key },
    name: index.name,
    ...(index.unique ? { unique: true } : {}),
  })),
);
await database.createCollection(onboardingCollectionName);
await database.collection(onboardingCollectionName).createIndexes(
  mongoOnboardingProfileIndexes().map((index) => ({
    key: { ...index.key },
    name: index.name,
    ...(index.unique ? { unique: true } : {}),
    ...(index.partialFilterExpression
      ? { partialFilterExpression: structuredClone(index.partialFilterExpression) }
      : {}),
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
    onboardingProfileStore,
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

  const onboarding = await request(first.baseUrl, '/v1/control-plane/onboarding/profiles', {
    method: 'POST',
    token: onboardingToken,
    body: {
      label: 'ERP tenant Mongo',
      capabilities: {
        locale: 'es',
        canReadDatabase: true,
      },
    },
  });
  assert.equal(onboarding.response.status, 201);
  assert.equal(onboarding.payload.organizationId, 'org-mongo-001');
  assert.equal(onboarding.payload.strategy.channel, 'database_read');
  assert.equal(onboarding.payload.localAgent.status, 'not-provisioned');
  const onboardingProfileId = onboarding.payload.profileId;

  const otherTenantList = await request(first.baseUrl, '/v1/control-plane/onboarding/profiles', {
    token: otherTenantToken,
  });
  assert.equal(otherTenantList.response.status, 200);
  assert.deepEqual(otherTenantList.payload.profiles, []);

  const bind = await request(
    first.baseUrl,
    '/v1/control-plane/onboarding/profiles/' + onboardingProfileId + '/integration',
    {
      method: 'PATCH',
      token: onboardingToken,
      body: {
        mappingProfileId: 'mongo-map-v1',
        integrationProfileId: 'mongo-int-v1',
      },
    },
  );
  assert.equal(bind.response.status, 200);
  assert.equal(bind.payload.integrationDraft.status, 'bound');

  const onboardingProvision = await request(
    first.baseUrl,
    '/v1/control-plane/onboarding/profiles/' + onboardingProfileId + '/provision-local-agent',
    {
      method: 'POST',
      token: onboardingToken,
      body: {},
    },
  );
  assert.equal(onboardingProvision.response.status, 201);
  assert.equal(onboardingProvision.payload.profile.organizationId, 'org-mongo-001');
  assert.equal(onboardingProvision.payload.profile.localAgent.status, 'provisioned');
  assert.match(onboardingProvision.payload.credential.token, /^pvla_/);
  const onboardingAgentToken = onboardingProvision.payload.credential.token;
  await first.runtime.close();

  const second = await createRuntime();
  try {
    const listed = await request(second.baseUrl, '/v1/control-plane/local-agents');
    assert.equal(listed.response.status, 200);
    assert.ok(listed.payload.installations.length >= 2);
    assert.ok(listed.payload.installations.some((item) => item.organizationId === 'org-mongo-001'));
    assert.ok(listed.payload.installations.every((item) => !('tokenSha256' in item)));

    const onboardingAfterRestart = await request(
      second.baseUrl,
      '/v1/control-plane/onboarding/profiles',
      { token: onboardingToken },
    );
    assert.equal(onboardingAfterRestart.response.status, 200);
    assert.equal(onboardingAfterRestart.payload.profiles.length, 1);
    assert.equal(onboardingAfterRestart.payload.profiles[0].profileId, onboardingProfileId);
    assert.equal(onboardingAfterRestart.payload.profiles[0].localAgent.status, 'provisioned');
    assert.equal(onboardingAfterRestart.payload.profiles[0].integrationDraft.mappingProfileId, 'mongo-map-v1');

    const onboardingAgentHeartbeat = await request(second.baseUrl, '/v1/local-agent/heartbeat', {
      method: 'POST',
      token: onboardingAgentToken,
      body: {
        agentVersion: '0.1.0',
        platform: 'linux',
        arch: 'x64',
        sourceKind: 'database',
        queue: {},
      },
    });
    assert.equal(onboardingAgentHeartbeat.response.status, 200);
    assert.equal(onboardingAgentHeartbeat.payload.installation.organizationId, 'org-mongo-001');

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

  const onboardingIndexes = await database.collection(onboardingCollectionName).indexes();
  assert.ok(onboardingIndexes.some((index) => index.name === 'onboarding_tenant_profile_unique' && index.unique));
  assert.ok(onboardingIndexes.some((index) => index.name === 'onboarding_local_agent_installation_unique' && index.unique));

  const storedOnboarding = await database.collection(onboardingCollectionName).findOne({
    organizationId: 'org-mongo-001',
    profileId: onboardingProfileId,
  });
  const onboardingSerialized = JSON.stringify(storedOnboarding).toLowerCase();
  for (const secretName of ['apikey', 'password', 'privatekey', 'certificatepath', 'pfx', 'tokensha256']) {
    assert.equal(onboardingSerialized.includes(secretName), false);
  }

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
    onboarding_profiles_mongodb: true,
    onboarding_tenant_isolation: true,
    onboarding_local_agent_transition: true,
  }, null, 2));
} finally {
  await database.dropDatabase().catch(() => {});
  await client.close();
}
