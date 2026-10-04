import test from 'node:test';
import assert from 'node:assert/strict';
import { hashBearerToken } from '../src/auth.mjs';
import { createPuenteRuntime } from '../src/runtime.mjs';
import { KairosethIntegrationProfileControlPlane } from '../src/integration-control-plane.mjs';
import {
  MongoKairosethIntegrationProfileStore,
} from '../../../packages/kairoseth-control-plane/src/mongodb-integration-profiles.mjs';

const apiToken = 'dynamic-integration-api';
const managerToken = 'dynamic-integration-manager';
const dynamicProfileId = 'int_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function authConfig() {
  return {
    credentials: [
      {
        id: 'data-plane',
        type: 'bearer',
        tokenSha256: hashBearerToken(apiToken),
        organizationId: 'org-dynamic',
        installationId: 'install-dynamic',
        sourceSystem: 'dynamic-api',
        rateLimitPerMinute: 1000,
        permissions: [],
      },
      {
        id: 'control-plane',
        type: 'bearer',
        tokenSha256: hashBearerToken(managerToken),
        organizationId: 'org-dynamic',
        installationId: 'kairoseth-ui',
        sourceSystem: 'kairoseth',
        rateLimitPerMinute: 1000,
        permissions: ['onboarding:manage'],
      },
    ],
  };
}

function mapping(id, sourceField = 'numero') {
  return {
    profileVersion: 1,
    id,
    name: 'Dynamic mapping',
    sourceType: 'api',
    fields: {
      [sourceField]: 'number',
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
}

function source() {
  return {
    numero: '1',
    fecha: '2026-09-15',
    tipo: 'F2',
    descripcion: 'Servicio dinámico',
    base: '100.00',
    iva: '21',
    cuota: '21.00',
    total: '121.00',
  };
}

class MemoryIntegrationProfileStore {
  constructor() {
    this.rows = new Map();
  }

  key(org, profileId) {
    return `${org}:${profileId}`;
  }

  clone(value) {
    return value == null ? null : structuredClone(value);
  }

  async create(record) {
    const row = {
      ...this.clone(record),
      mappingProfile: this.clone(record.mappingProfile),
      webhookSecretRef: record.webhookSecretRef ?? null,
      authBinding: structuredClone(record.authBinding ?? {
        provider: 'kairoseth',
        status: 'unbound',
        credentialId: null,
      }),
    };
    this.rows.set(this.key(record.organizationId, record.profileId), row);
    return this.public(row);
  }

  public(row) {
    if (!row) return null;
    return {
      profileId: row.profileId,
      organizationId: row.organizationId,
      installationId: row.installationId,
      onboardingProfileId: row.onboardingProfileId ?? null,
      channel: row.channel,
      adapter: row.adapter,
      sourceType: row.sourceType,
      deploymentMode: row.deploymentMode,
      status: row.status,
      mappingProfile: this.clone(row.mappingProfile),
      mappingProfileId: row.mappingProfile?.id ?? null,
      webhookSecretConfigured: Boolean(row.webhookSecretRef),
      authBinding: structuredClone(row.authBinding ?? {
        provider: 'kairoseth',
        status: 'unbound',
        credentialId: null,
      }),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async get(org, profileId) {
    return this.public(this.rows.get(this.key(org, profileId)));
  }

  async getInternal(org, profileId) {
    return this.clone(this.rows.get(this.key(org, profileId)));
  }

  async findByOnboarding(org, onboardingProfileId) {
    const row = [...this.rows.values()].find(
      (item) => item.organizationId === org && item.onboardingProfileId === onboardingProfileId,
    );
    return this.public(row);
  }

  async findForContext({ organizationId, installationId, profileId }) {
    const row = this.rows.get(this.key(organizationId, profileId));
    if (!row || row.installationId !== installationId) return null;
    return this.clone(row);
  }

  async list(org) {
    return [...this.rows.values()]
      .filter((row) => row.organizationId === org)
      .map((row) => this.public(row));
  }

  async setMapping({ organizationId, profileId, mappingProfile, now }) {
    const row = this.rows.get(this.key(organizationId, profileId));
    if (!row || row.status === 'disabled') {
      throw Object.assign(new Error('not found'), { code: 'VF_INTEGRATION_PROFILE_NOT_FOUND', status: 404 });
    }
    row.mappingProfile = this.clone(mappingProfile);
    row.status = 'active';
    row.updatedAt = now;
    return this.public(row);
  }

  async setWebhookSecretRef({ organizationId, profileId, webhookSecretRef, now }) {
    const row = this.rows.get(this.key(organizationId, profileId));
    if (!row) throw Object.assign(new Error('not found'), { code: 'VF_INTEGRATION_PROFILE_NOT_FOUND', status: 404 });
    row.webhookSecretRef = webhookSecretRef;
    row.updatedAt = now;
    return this.public(row);
  }

  async setAuthBinding({ organizationId, profileId, credentialId, status, now }) {
    const row = this.rows.get(this.key(organizationId, profileId));
    if (!row) throw Object.assign(new Error('not found'), { code: 'VF_INTEGRATION_PROFILE_NOT_FOUND', status: 404 });
    row.authBinding = {
      provider: 'kairoseth',
      credentialId,
      status,
    };
    row.updatedAt = now;
    return this.public(row);
  }

  async disable({ organizationId, profileId, now }) {
    const row = this.rows.get(this.key(organizationId, profileId));
    if (!row) throw Object.assign(new Error('not found'), { code: 'VF_INTEGRATION_PROFILE_NOT_FOUND', status: 404 });
    row.status = 'disabled';
    row.updatedAt = now;
    return this.public(row);
  }
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
  return `http://127.0.0.1:${address.port}`;
}

async function jsonRequest(baseUrl, token, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test('dynamic Mongo integration profile wins over static config and stamps server identity', async () => {
  const store = new MemoryIntegrationProfileStore();
  const scopedToken = 'kairoseth_scoped_dynamic_' + 'x'.repeat(32);
  const scopedCredentialId = 'dynamic-kcred-1';
  await store.create({
    profileId: dynamicProfileId,
    organizationId: 'org-dynamic',
    installationId: 'install-dynamic',
    onboardingProfileId: null,
    channel: 'rest_api',
    adapter: 'universal-rest',
    sourceType: 'api',
    deploymentMode: 'server-to-server',
    status: 'active',
    mappingProfile: mapping(dynamicProfileId, 'numero'),
    webhookSecretRef: null,
    authBinding: {
      provider: 'kairoseth',
      status: 'active',
      credentialId: scopedCredentialId,
    },
    now: 1,
  });

  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    integrationProfileStore: store,
    kairosethAuthProvider: {
      resolveBearerDigest: async (digest) => (
        digest === hashBearerToken(scopedToken)
          ? {
              credentialId: scopedCredentialId,
              organizationId: 'org-dynamic',
              installationId: 'install-dynamic',
              sourceSystem: 'universal-rest',
              profileId: dynamicProfileId,
              rateLimitPerMinute: 500,
              permissions: [],
            }
          : null
      ),
    },
    integrationConfig: {
      integrations: [{
        id: dynamicProfileId,
        organizationId: 'org-dynamic',
        installationId: 'install-dynamic',
        mappingProfile: mapping(dynamicProfileId, 'staticOnly'),
      }],
      euroConversions: [],
    },
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    clock: () => new Date('2026-09-15T09:00:00Z'),
  });

  try {
    const baseUrl = await listen(runtime);
    const preflight = await jsonRequest(baseUrl, scopedToken, '/v1/preflight', {
      method: 'POST',
      body: {
        profileId: dynamicProfileId,
        source: source(),
      },
    });
    assert.equal(preflight.response.status, 200);
    assert.equal(preflight.body.ok, true);
    assert.equal(preflight.body.preview.number, '1');
    assert.equal(preflight.body.preview.organizationId, 'org-dynamic');
    assert.equal(preflight.body.preview.installationId, 'install-dynamic');
    assert.equal(preflight.body.preview.sourceSystem, 'universal-rest');

    const list = await jsonRequest(baseUrl, managerToken, '/v1/control-plane/integration-profiles');
    assert.equal(list.response.status, 200);
    assert.equal(list.body.profiles.length, 1);
    assert.equal(list.body.profiles[0].profileId, dynamicProfileId);
    assert.equal('webhookSecretRef' in list.body.profiles[0], false);
  } finally {
    await runtime.close();
  }
});

test('disabled dynamic profile does not fall back to static config', async () => {
  const store = new MemoryIntegrationProfileStore();
  await store.create({
    profileId: dynamicProfileId,
    organizationId: 'org-dynamic',
    installationId: 'install-dynamic',
    onboardingProfileId: null,
    channel: 'rest_api',
    adapter: 'universal-rest',
    sourceType: 'api',
    deploymentMode: 'server-to-server',
    status: 'disabled',
    mappingProfile: mapping(dynamicProfileId, 'numero'),
    webhookSecretRef: null,
    authBinding: {
      provider: 'kairoseth',
      status: 'active',
      credentialId: 'data-plane',
    },
    now: 1,
  });

  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    integrationProfileStore: store,
    integrationConfig: {
      integrations: [{
        id: dynamicProfileId,
        organizationId: 'org-dynamic',
        installationId: 'install-dynamic',
        mappingProfile: mapping(dynamicProfileId, 'numero'),
      }],
      euroConversions: [],
    },
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
  });

  try {
    const baseUrl = await listen(runtime);
    const response = await jsonRequest(baseUrl, apiToken, '/v1/preflight', {
      method: 'POST',
      body: { profileId: dynamicProfileId, source: source() },
    });
    assert.equal(response.response.status, 404);
    assert.equal(response.body.error.code, 'VF_API_MAPPING_PROFILE_NOT_FOUND');
  } finally {
    await runtime.close();
  }
});

test('static integration config remains a reference fallback when no dynamic profile exists', async () => {
  const store = new MemoryIntegrationProfileStore();
  const staticId = 'static-v1';
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    integrationProfileStore: store,
    integrationConfig: {
      integrations: [{
        id: staticId,
        organizationId: 'org-dynamic',
        installationId: 'install-dynamic',
        mappingProfile: mapping(staticId, 'numero'),
      }],
      euroConversions: [],
    },
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
  });

  try {
    const baseUrl = await listen(runtime);
    const response = await jsonRequest(baseUrl, apiToken, '/v1/preflight', {
      method: 'POST',
      body: { profileId: staticId, source: source() },
    });
    assert.equal(response.response.status, 200);
    assert.equal(response.body.ok, true);
  } finally {
    await runtime.close();
  }
});

test('Mongo dynamic mapping rejects nested tenant authority and secrets before persistence', async () => {
  let updateCalled = false;
  const collection = {
    findOne: async () => null,
    updateOne: async () => {
      updateCalled = true;
      return { matchedCount: 1 };
    },
  };
  const database = { collection: () => collection };
  const store = new MongoKairosethIntegrationProfileStore({ database });

  const malicious = mapping(dynamicProfileId);
  malicious.constants.nested = {
    organizationId: 'other-org',
  };

  await assert.rejects(
    () => store.setMapping({
      organizationId: 'org-dynamic',
      profileId: dynamicProfileId,
      mappingProfile: malicious,
      now: 1,
    }),
    (error) => error.code === 'VF_INTEGRATION_MAPPING_AUTHORITY_FORBIDDEN',
  );
  assert.equal(updateCalled, false);
});

test('webhook secret references stay opaque and resolve only through Kairoseth', async () => {
  const store = new MemoryIntegrationProfileStore();
  await store.create({
    profileId: dynamicProfileId,
    organizationId: 'org-dynamic',
    installationId: 'install-dynamic',
    onboardingProfileId: null,
    channel: 'webhook',
    adapter: 'universal-webhook',
    sourceType: 'webhook',
    deploymentMode: 'server-to-server',
    status: 'active',
    mappingProfile: mapping(dynamicProfileId),
    webhookSecretRef: 'secret:webhook:001',
    authBinding: {
      provider: 'kairoseth',
      status: 'active',
      credentialId: 'cred-webhook',
    },
    now: 1,
  });

  const control = new KairosethIntegrationProfileControlPlane({
    store,
    resolveSecretReference: async ({ ref, organizationId, installationId, profileId }) => {
      assert.equal(ref, 'secret:webhook:001');
      assert.equal(organizationId, 'org-dynamic');
      assert.equal(installationId, 'install-dynamic');
      assert.equal(profileId, dynamicProfileId);
      return 'w'.repeat(40);
    },
  });

  const resolved = await control.resolveWebhookSecret({
    context: {
      credentialId: 'cred-webhook',
      organizationId: 'org-dynamic',
      installationId: 'install-dynamic',
      sourceSystem: 'universal-webhook',
      profileId: dynamicProfileId,
    },
    profileId: dynamicProfileId,
  });
  assert.equal(resolved.exists, true);
  assert.equal(resolved.secret, 'w'.repeat(40));

  const publicProfile = await control.get(
    { organizationId: 'org-dynamic' },
    dynamicProfileId,
  );
  assert.equal(publicProfile.webhookSecretConfigured, true);
  assert.equal('webhookSecretRef' in publicProfile, false);
  assert.equal('webhookSecret' in publicProfile, false);

  await assert.rejects(
    () => control.setWebhookSecretReference(
      { organizationId: 'org-dynamic' },
      dynamicProfileId,
      { webhookSecret: 'plain-secret-that-must-never-be-stored' },
    ),
    (error) => error.code === 'VF_INTEGRATION_SECRET_INPUT_INVALID',
  );
});

class FakeKairosethAuthProvider {
  constructor() {
    this.byDigest = new Map();
    this.byCredential = new Map();
    this.sequence = 0;
  }

  make(identity) {
    this.sequence += 1;
    const credentialId = `kcred-${this.sequence}`;
    const token = `kairoseth_data_plane_${String(this.sequence).padStart(4, '0')}_${'x'.repeat(32)}`;
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
    return this.make(identity);
  }

  async rotateDataPlaneCredential({ credentialId, ...identity }) {
    const previous = this.byCredential.get(credentialId);
    if (previous) this.byDigest.delete(previous.digest);
    this.byCredential.delete(credentialId);
    return this.make(identity);
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

test('Kairoseth Auth provisions, rotates and revokes dynamic API credentials without token persistence', async () => {
  const store = new MemoryIntegrationProfileStore();
  const profileId = 'int_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  await store.create({
    profileId,
    organizationId: 'org-dynamic',
    installationId: 'int-api-01',
    onboardingProfileId: null,
    channel: 'rest_api',
    adapter: 'universal-rest',
    sourceType: 'api',
    deploymentMode: 'server-to-server',
    status: 'active',
    mappingProfile: mapping(profileId),
    webhookSecretRef: null,
    now: 1,
  });

  const provider = new FakeKairosethAuthProvider();
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    integrationProfileStore: store,
    kairosethAuthProvider: provider,
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    clock: () => new Date('2026-09-15T09:00:00Z'),
  });

  try {
    const baseUrl = await listen(runtime);

    const injectedIdentity = await jsonRequest(
      baseUrl,
      managerToken,
      `/v1/control-plane/integration-profiles/${profileId}/credential`,
      {
        method: 'POST',
        body: { installationId: 'attacker-choice' },
      },
    );
    assert.equal(injectedIdentity.response.status, 400);
    assert.equal(injectedIdentity.body.error.code, 'VF_INTEGRATION_CREDENTIAL_INPUT_FORBIDDEN');

    const provisioned = await jsonRequest(
      baseUrl,
      managerToken,
      `/v1/control-plane/integration-profiles/${profileId}/credential`,
      { method: 'POST', body: {} },
    );
    assert.equal(provisioned.response.status, 201);
    assert.equal(provisioned.body.profile.authBinding.provider, 'kairoseth');
    assert.equal(provisioned.body.profile.authBinding.status, 'active');
    assert.match(provisioned.body.credential.token, /^kairoseth_data_plane_/);
    assert.equal(provisioned.body.credentialShownOnce, true);
    const firstToken = provisioned.body.credential.token;
    const firstCredentialId = provisioned.body.credential.credentialId;

    const persisted = await store.getInternal('org-dynamic', profileId);
    assert.equal(persisted.authBinding.credentialId, firstCredentialId);
    assert.equal(JSON.stringify(persisted).includes(firstToken), false);
    assert.equal('token' in persisted.authBinding, false);
    assert.equal('tokenSha256' in persisted.authBinding, false);

    const firstPreflight = await jsonRequest(baseUrl, firstToken, '/v1/preflight', {
      method: 'POST',
      body: { profileId, source: source() },
    });
    assert.equal(firstPreflight.response.status, 200);
    assert.equal(firstPreflight.body.ok, true);
    assert.equal(firstPreflight.body.preview.organizationId, 'org-dynamic');
    assert.equal(firstPreflight.body.preview.installationId, 'int-api-01');
    assert.equal(firstPreflight.body.preview.sourceSystem, 'universal-rest');

    const issued = await jsonRequest(baseUrl, firstToken, '/v1/fiscal-records', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'dynamic-own-record' },
      body: { profileId, source: source() },
    });
    assert.equal(issued.response.status, 202);
    assert.equal(issued.body.integrationProfileId, profileId);
    assert.equal(issued.body.installationId, 'int-api-01');
    assert.equal(issued.body.sourceSystem, 'universal-rest');

    const ownRecord = await jsonRequest(
      baseUrl,
      firstToken,
      `/v1/fiscal-records/${issued.body.recordId}`,
    );
    assert.equal(ownRecord.response.status, 200);

    const ownStatus = await jsonRequest(
      baseUrl,
      firstToken,
      `/v1/fiscal-records/${issued.body.recordId}/status`,
    );
    assert.equal(ownStatus.response.status, 200);
    assert.equal(ownStatus.body.integrationProfileId, profileId);
    assert.equal(ownStatus.body.operation, 'issue');

    const ownCancellation = await jsonRequest(
      baseUrl,
      firstToken,
      `/v1/fiscal-records/${issued.body.recordId}/cancel`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'dynamic-own-cancel' },
        body: { sourceCancellationId: 'dynamic-cancel-1' },
      },
    );
    assert.equal(ownCancellation.response.status, 202);
    assert.equal(ownCancellation.body.integrationProfileId, profileId);
    assert.equal(ownCancellation.body.installationId, 'int-api-01');
    assert.equal(ownCancellation.body.sourceSystem, 'universal-rest');

    const ownCancellationStatus = await jsonRequest(
      baseUrl,
      firstToken,
      `/v1/fiscal-records/${ownCancellation.body.recordId}/status`,
    );
    assert.equal(ownCancellationStatus.response.status, 200);
    assert.equal(ownCancellationStatus.body.operation, 'cancel');
    assert.equal(ownCancellationStatus.body.integrationProfileId, profileId);

    const foreignProfileId = 'int_dddddddddddddddddddddddddddddddd';
    const foreign = await runtime.bridge.issueMapped(
      { ...source(), numero: '2' },
      mapping(foreignProfileId),
      {
        organizationId: 'org-dynamic',
        installationId: 'int-api-02',
        sourceSystem: 'universal-rest',
      },
      {
        idempotencyKey: 'foreign-resource',
      },
    );
    assert.equal(foreign.integrationProfileId, foreignProfileId);

    const foreignGet = await jsonRequest(
      baseUrl,
      firstToken,
      `/v1/fiscal-records/${foreign.recordId}`,
    );
    assert.equal(foreignGet.response.status, 404);
    assert.equal(foreignGet.body.error.code, 'VF_API_RECORD_NOT_FOUND');

    const foreignStatus = await jsonRequest(
      baseUrl,
      firstToken,
      `/v1/fiscal-records/${foreign.recordId}/status`,
    );
    assert.equal(foreignStatus.response.status, 404);
    assert.equal(foreignStatus.body.error.code, 'VF_API_RECORD_NOT_FOUND');

    const directIntentBypass = await jsonRequest(baseUrl, firstToken, '/v1/preflight', {
      method: 'POST',
      body: { intent: {} },
    });
    assert.equal(directIntentBypass.response.status, 403);
    assert.equal(
      directIntentBypass.body.error.code,
      'VF_API_INTEGRATION_PROFILE_SCOPE_REQUIRED',
    );

    const wrongProfile = await jsonRequest(baseUrl, firstToken, '/v1/preflight', {
      method: 'POST',
      body: {
        profileId: 'int_cccccccccccccccccccccccccccccccc',
        source: source(),
      },
    });
    assert.equal(wrongProfile.response.status, 403);
    assert.equal(wrongProfile.body.error.code, 'VF_API_INTEGRATION_PROFILE_SCOPE_REQUIRED');

    const rotated = await jsonRequest(
      baseUrl,
      managerToken,
      `/v1/control-plane/integration-profiles/${profileId}/credential/rotate`,
      { method: 'POST', body: {} },
    );
    assert.equal(rotated.response.status, 200);
    const secondToken = rotated.body.credential.token;
    assert.notEqual(secondToken, firstToken);
    assert.notEqual(rotated.body.credential.credentialId, firstCredentialId);

    const oldToken = await jsonRequest(baseUrl, firstToken, '/v1/preflight', {
      method: 'POST',
      body: { profileId, source: source() },
    });
    assert.equal(oldToken.response.status, 401);

    const secondPreflight = await jsonRequest(baseUrl, secondToken, '/v1/preflight', {
      method: 'POST',
      body: { profileId, source: source() },
    });
    assert.equal(secondPreflight.response.status, 200);
    assert.equal(secondPreflight.body.ok, true);

    const revoked = await jsonRequest(
      baseUrl,
      managerToken,
      `/v1/control-plane/integration-profiles/${profileId}/credential/revoke`,
      { method: 'POST', body: {} },
    );
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.body.profile.authBinding.status, 'revoked');

    const revokedToken = await jsonRequest(baseUrl, secondToken, '/v1/preflight', {
      method: 'POST',
      body: { profileId, source: source() },
    });
    assert.equal(revokedToken.response.status, 401);
  } finally {
    await runtime.close();
  }
});
