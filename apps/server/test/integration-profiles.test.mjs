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

async function jsonRequest(baseUrl, token, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test('dynamic Mongo integration profile wins over static config and stamps server identity', async () => {
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
    status: 'active',
    mappingProfile: mapping(dynamicProfileId, 'numero'),
    webhookSecretRef: null,
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
        mappingProfile: mapping(dynamicProfileId, 'staticOnly'),
      }],
      euroConversions: [],
    },
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    clock: () => new Date('2026-09-15T09:00:00Z'),
  });

  try {
    const baseUrl = await listen(runtime);
    const preflight = await jsonRequest(baseUrl, apiToken, '/v1/preflight', {
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
    assert.equal(preflight.body.preview.sourceSystem, 'dynamic-api');

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
      organizationId: 'org-dynamic',
      installationId: 'install-dynamic',
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
