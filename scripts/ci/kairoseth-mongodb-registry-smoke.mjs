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
import {
  createMongoKairosethIntegrationProfileStore,
  mongoIntegrationProfileIndexes,
} from '../../packages/kairoseth-control-plane/src/mongodb-integration-profiles.mjs';

const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018';
const client = new MongoClient(uri);
const databaseName = 'kairoseth_control_plane_smoke';
const collectionName = 'kairoseth_local_agent_installations_smoke';
const onboardingCollectionName = 'kairoseth_onboarding_profiles_smoke';
const integrationCollectionName = 'kairoseth_integration_profiles_smoke';
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

class FakeKairosethAuthProvider {
  constructor() {
    this.byDigest = new Map();
    this.byCredential = new Map();
    this.sequence = 0;
  }

  issue(identity) {
    this.sequence += 1;
    const credentialId = `mongo-kcred-${this.sequence}`;
    const token = `mongo_kairoseth_data_plane_${this.sequence}_${'x'.repeat(32)}`;
    const digest = hashBearerToken(token);
    const context = {
      credentialId,
      organizationId: identity.organizationId,
      installationId: identity.installationId,
      sourceSystem: identity.sourceSystem,
      profileId: identity.profileId,
      rateLimitPerMinute: 500,
      permissions: [],
    };
    this.byDigest.set(digest, context);
    this.byCredential.set(credentialId, { digest, context });
    return { credentialId, token, ...identity };
  }

  async provisionDataPlaneCredential(identity) {
    return this.issue(identity);
  }

  async rotateDataPlaneCredential({ credentialId, ...identity }) {
    const previous = this.byCredential.get(credentialId);
    if (previous) this.byDigest.delete(previous.digest);
    this.byCredential.delete(credentialId);
    return this.issue(identity);
  }

  async revokeDataPlaneCredential({ credentialId }) {
    const previous = this.byCredential.get(credentialId);
    if (previous) this.byDigest.delete(previous.digest);
    this.byCredential.delete(credentialId);
    return true;
  }

  async resolveBearerDigest(digest) {
    return this.byDigest.get(digest) ?? null;
  }
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
assert.equal(before.some((item) => item.name === integrationCollectionName), false);

const registry = createMongoKairosethLocalAgentRegistryStore({ database, collectionName });
const onboardingProfileStore = createMongoKairosethOnboardingProfileStore({
  database,
  collectionName: onboardingCollectionName,
});
const integrationProfileStore = createMongoKairosethIntegrationProfileStore({
  database,
  collectionName: integrationCollectionName,
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
assert.equal(
  afterConstructor.some((item) => item.name === integrationCollectionName),
  false,
  'Integration adapter constructor must not create MongoDB infrastructure',
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
await database.createCollection(integrationCollectionName);
await database.collection(integrationCollectionName).createIndexes(
  mongoIntegrationProfileIndexes().map((index) => ({
    key: { ...index.key },
    name: index.name,
    ...(index.unique ? { unique: true } : {}),
    ...(index.partialFilterExpression
      ? { partialFilterExpression: structuredClone(index.partialFilterExpression) }
      : {}),
  })),
);

const nowRef = { value: Date.UTC(2026, 9, 3, 21, 0, 0) };
const kairosethAuthProvider = new FakeKairosethAuthProvider();
const createRuntime = async () => {
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    observabilityClock: () => nowRef.value,
    localAgentRegistryStore: registry,
    onboardingProfileStore,
    integrationProfileStore,
    kairosethAuthProvider,
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
  assert.ok(onboardingProvision.payload.integration);
  assert.match(onboardingProvision.payload.integration.profileId, /^int_[a-f0-9]{32}$/);
  assert.equal(onboardingProvision.payload.integration.status, 'mapping-required');
  assert.equal(
    onboardingProvision.payload.integration.installationId,
    onboardingProvision.payload.profile.localAgent.installationId,
  );
  assert.match(onboardingProvision.payload.credential.token, /^pvla_/);
  const onboardingAgentToken = onboardingProvision.payload.credential.token;
  const integrationProfileId = onboardingProvision.payload.integration.profileId;

  const mapping = {
    profileVersion: 1,
    id: integrationProfileId,
    name: 'ERP Mongo dynamic mapping',
    sourceType: 'database',
    locale: 'es-ES',
    fields: {
      numero: 'number',
      fecha: 'issueDate',
      tipo: 'invoiceType',
      descripcion: 'description',
      base: 'taxBreakdown.0.baseAmount',
      iva: 'taxBreakdown.0.rate',
      cuota: 'taxBreakdown.0.taxAmount',
      total: 'totals.totalAmount',
    },
    transforms: {},
    constants: {
      issuer: { name: 'Empresa Demo', taxId: '89890001K' },
      currency: 'EUR',
      taxBreakdown: [{
        taxCode: '01',
        regimeKey: '01',
        operationClass: 'S1',
      }],
    },
    defaults: {},
  };

  const mapped = await request(
    first.baseUrl,
    '/v1/control-plane/integration-profiles/' + integrationProfileId + '/mapping',
    {
      method: 'PUT',
      token: onboardingToken,
      body: { mappingProfile: mapping },
    },
  );
  assert.equal(mapped.response.status, 200);
  assert.equal(mapped.payload.status, 'active');
  assert.equal(mapped.payload.mappingProfileId, integrationProfileId);
  assert.equal('webhookSecretRef' in mapped.payload, false);

  const crossTenantIntegration = await request(
    first.baseUrl,
    '/v1/control-plane/integration-profiles/' + integrationProfileId,
    { token: otherTenantToken },
  );
  assert.equal(crossTenantIntegration.response.status, 404);

  const apiOnboarding = await request(first.baseUrl, '/v1/control-plane/onboarding/profiles', {
    method: 'POST',
    token: onboardingToken,
    body: {
      label: 'API ERP Mongo',
      capabilities: {
        locale: 'es',
        hasApi: true,
      },
    },
  });
  assert.equal(apiOnboarding.response.status, 201);
  assert.equal(apiOnboarding.payload.strategy.channel, 'rest_api');
  const apiOnboardingProfileId = apiOnboarding.payload.profileId;

  const apiMaterialized = await request(
    first.baseUrl,
    '/v1/control-plane/onboarding/profiles/' + apiOnboardingProfileId + '/materialize-integration',
    {
      method: 'POST',
      token: onboardingToken,
      body: {},
    },
  );
  assert.equal(apiMaterialized.response.status, 201);
  assert.equal(apiMaterialized.payload.integration.status, 'mapping-required');
  const apiIntegrationProfileId = apiMaterialized.payload.integration.profileId;

  const apiMapping = {
    ...mapping,
    id: apiIntegrationProfileId,
    name: 'API Mongo dynamic mapping',
    sourceType: 'api',
  };
  const apiMapped = await request(
    first.baseUrl,
    '/v1/control-plane/integration-profiles/' + apiIntegrationProfileId + '/mapping',
    {
      method: 'PUT',
      token: onboardingToken,
      body: { mappingProfile: apiMapping },
    },
  );
  assert.equal(apiMapped.response.status, 200);
  assert.equal(apiMapped.payload.status, 'active');

  const apiCredential = await request(
    first.baseUrl,
    '/v1/control-plane/integration-profiles/' + apiIntegrationProfileId + '/credential',
    {
      method: 'POST',
      token: onboardingToken,
      body: {},
    },
  );
  assert.equal(apiCredential.response.status, 201);
  assert.equal(apiCredential.payload.profile.authBinding.provider, 'kairoseth');
  assert.equal(apiCredential.payload.profile.authBinding.status, 'active');
  assert.match(apiCredential.payload.credential.token, /^mongo_kairoseth_data_plane_/);
  const apiTokenOne = apiCredential.payload.credential.token;
  const apiCredentialIdOne = apiCredential.payload.credential.credentialId;

  const apiStoredAfterProvision = await database.collection(integrationCollectionName).findOne({
    organizationId: 'org-mongo-001',
    profileId: apiIntegrationProfileId,
  });
  assert.equal(apiStoredAfterProvision.authBinding.credentialId, apiCredentialIdOne);
  assert.equal(JSON.stringify(apiStoredAfterProvision).includes(apiTokenOne), false);
  assert.equal(Object.prototype.hasOwnProperty.call(apiStoredAfterProvision.authBinding, 'token'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(apiStoredAfterProvision.authBinding, 'tokenSha256'), false);

  const apiPreflight = await request(first.baseUrl, '/v1/preflight', {
    method: 'POST',
    token: apiTokenOne,
    body: {
      profileId: apiIntegrationProfileId,
      source: {
        numero: '9101',
        fecha: '2026-09-15',
        tipo: 'F2',
        descripcion: 'Servicio API desde Kairoseth Auth',
        base: '100.00',
        iva: '21',
        cuota: '21.00',
        total: '121.00',
      },
    },
  });
  assert.equal(apiPreflight.response.status, 200);
  assert.equal(apiPreflight.payload.ok, true);
  assert.equal(apiPreflight.payload.preview.organizationId, 'org-mongo-001');
  assert.equal(
    apiPreflight.payload.preview.installationId,
    apiCredential.payload.profile.installationId,
  );
  assert.equal(apiPreflight.payload.preview.sourceSystem, 'universal-rest');

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
    assert.equal(
      onboardingAfterRestart.payload.profiles[0].integrationDraft.integrationProfileId,
      integrationProfileId,
    );
    assert.equal(
      onboardingAfterRestart.payload.profiles[0].integrationDraft.mappingProfileId,
      integrationProfileId,
    );

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

    const dynamicPreflight = await request(second.baseUrl, '/v1/preflight', {
      method: 'POST',
      token: onboardingAgentToken,
      body: {
        profileId: integrationProfileId,
        source: {
          numero: '9001',
          fecha: '2026-09-15',
          tipo: 'F2',
          descripcion: 'Servicio desde ERP Mongo',
          base: '100.00',
          iva: '21',
          cuota: '21.00',
          total: '121.00',
        },
      },
    });
    assert.equal(dynamicPreflight.response.status, 200);
    assert.equal(dynamicPreflight.payload.ok, true);
    assert.equal(dynamicPreflight.payload.preview.number, '9001');
    assert.equal(dynamicPreflight.payload.preview.organizationId, 'org-mongo-001');
    assert.equal(
      dynamicPreflight.payload.preview.installationId,
      onboardingProvision.payload.profile.localAgent.installationId,
    );
    assert.equal(dynamicPreflight.payload.preview.sourceSystem, 'local-agent');

    const apiTokenAfterRestart = await request(second.baseUrl, '/v1/preflight', {
      method: 'POST',
      token: apiTokenOne,
      body: {
        profileId: apiIntegrationProfileId,
        source: {
          numero: '9102',
          fecha: '2026-09-15',
          tipo: 'F2',
          descripcion: 'API after restart',
          base: '100.00',
          iva: '21',
          cuota: '21.00',
          total: '121.00',
        },
      },
    });
    assert.equal(apiTokenAfterRestart.response.status, 200);
    assert.equal(apiTokenAfterRestart.payload.ok, true);

    const apiRotated = await request(
      second.baseUrl,
      '/v1/control-plane/integration-profiles/' + apiIntegrationProfileId + '/credential/rotate',
      {
        method: 'POST',
        token: onboardingToken,
        body: {},
      },
    );
    assert.equal(apiRotated.response.status, 200);
    const apiTokenTwo = apiRotated.payload.credential.token;
    assert.notEqual(apiTokenTwo, apiTokenOne);

    const apiOldToken = await request(second.baseUrl, '/v1/preflight', {
      method: 'POST',
      token: apiTokenOne,
      body: { profileId: apiIntegrationProfileId, source: {} },
    });
    assert.equal(apiOldToken.response.status, 401);

    const apiNewToken = await request(second.baseUrl, '/v1/preflight', {
      method: 'POST',
      token: apiTokenTwo,
      body: {
        profileId: apiIntegrationProfileId,
        source: {
          numero: '9103',
          fecha: '2026-09-15',
          tipo: 'F2',
          descripcion: 'API rotated',
          base: '100.00',
          iva: '21',
          cuota: '21.00',
          total: '121.00',
        },
      },
    });
    assert.equal(apiNewToken.response.status, 200);
    assert.equal(apiNewToken.payload.ok, true);

    const apiRevoked = await request(
      second.baseUrl,
      '/v1/control-plane/integration-profiles/' + apiIntegrationProfileId + '/credential/revoke',
      {
        method: 'POST',
        token: onboardingToken,
        body: {},
      },
    );
    assert.equal(apiRevoked.response.status, 200);
    assert.equal(apiRevoked.payload.profile.authBinding.status, 'revoked');

    const apiRevokedToken = await request(second.baseUrl, '/v1/preflight', {
      method: 'POST',
      token: apiTokenTwo,
      body: { profileId: apiIntegrationProfileId, source: {} },
    });
    assert.equal(apiRevokedToken.response.status, 401);

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

  const integrationIndexes = await database.collection(integrationCollectionName).indexes();
  assert.ok(integrationIndexes.some((index) => index.name === 'integration_tenant_profile_unique' && index.unique));
  assert.ok(integrationIndexes.some((index) => index.name === 'integration_tenant_installation_profile_unique' && index.unique));

  const storedOnboarding = await database.collection(onboardingCollectionName).findOne({
    organizationId: 'org-mongo-001',
    profileId: onboardingProfileId,
  });
  const onboardingSerialized = JSON.stringify(storedOnboarding).toLowerCase();
  for (const secretName of ['apikey', 'password', 'privatekey', 'certificatepath', 'pfx', 'tokensha256']) {
    assert.equal(onboardingSerialized.includes(secretName), false);
  }

  const storedIntegration = await database.collection(integrationCollectionName).findOne({
    organizationId: 'org-mongo-001',
    profileId: integrationProfileId,
  });
  assert.ok(storedIntegration);
  assert.equal(storedIntegration.status, 'active');
  assert.equal(storedIntegration.webhookSecretRef, null);
  const integrationSerialized = JSON.stringify(storedIntegration).toLowerCase();
  for (const secretName of ['apikey', 'password', 'privatekey', 'certificatepath', 'pfx', 'tokensha256']) {
    assert.equal(integrationSerialized.includes(secretName), false);
  }

  const storedApiIntegration = await database.collection(integrationCollectionName).findOne({
    organizationId: 'org-mongo-001',
    onboardingProfileId: apiOnboardingProfileId,
  });
  assert.ok(storedApiIntegration);
  assert.equal(storedApiIntegration.authBinding.provider, 'kairoseth');
  assert.equal(storedApiIntegration.authBinding.status, 'revoked');
  assert.equal(Object.prototype.hasOwnProperty.call(storedApiIntegration.authBinding, 'token'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(storedApiIntegration.authBinding, 'tokenSha256'), false);

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
    integration_profiles_mongodb: true,
    integration_profile_dynamic_preflight: true,
    integration_tenant_installation_isolation: true,
    integration_json_role: 'reference-fallback',
    kairoseth_auth_bridge: true,
    data_plane_token_persistence: false,
    api_credential_rotation: true,
    api_credential_revocation: true,
  }, null, 2));
} finally {
  await database.dropDatabase().catch(() => {});
  await client.close();
}
