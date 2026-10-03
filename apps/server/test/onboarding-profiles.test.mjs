import test from 'node:test';
import assert from 'node:assert/strict';
import { hashBearerToken } from '../src/auth.mjs';
import { createPuenteRuntime } from '../src/runtime.mjs';

const tokenA = 'kairoseth-onboarding-org-a';
const tokenB = 'kairoseth-onboarding-org-b';

class MemoryOnboardingStore {
  constructor() {
    this.rows = new Map();
  }

  key(org, profileId) {
    return `${org}:${profileId}`;
  }

  clone(row) {
    return row ? structuredClone(row) : null;
  }

  async create(record) {
    const row = {
      ...structuredClone(record),
      integrationDraft: {
        ...structuredClone(record.integrationDraft),
        mappingProfileId: null,
        integrationProfileId: null,
      },
      localAgent: {
        required: Boolean(record.localAgent?.required),
        status: record.localAgent?.required ? 'not-provisioned' : 'not-required',
        installationId: null,
        lastErrorCode: null,
      },
      createdAt: record.now,
      updatedAt: record.now,
    };
    this.rows.set(this.key(record.organizationId, record.profileId), row);
    return this.clone(row);
  }

  async get(org, profileId) {
    return this.clone(this.rows.get(this.key(org, profileId)) ?? null);
  }

  async list(org) {
    return [...this.rows.values()]
      .filter((row) => row.organizationId === org)
      .map((row) => this.clone(row));
  }

  async bindIntegration({ organizationId, profileId, mappingProfileId, integrationProfileId, now }) {
    const key = this.key(organizationId, profileId);
    const row = this.rows.get(key);
    if (!row) throw Object.assign(new Error('not found'), { code: 'VF_ONBOARDING_PROFILE_NOT_FOUND', status: 404 });
    row.integrationDraft.mappingProfileId = mappingProfileId;
    row.integrationDraft.integrationProfileId = integrationProfileId;
    row.integrationDraft.status = 'bound';
    row.updatedAt = now;
    return this.clone(row);
  }

  async reserveLocalAgent({ organizationId, profileId, installationId, now }) {
    const key = this.key(organizationId, profileId);
    const row = this.rows.get(key);
    if (!row) throw Object.assign(new Error('not found'), { code: 'VF_ONBOARDING_PROFILE_NOT_FOUND', status: 404 });
    if (!row.localAgent.required) throw Object.assign(new Error('not required'), { code: 'VF_ONBOARDING_LOCAL_AGENT_NOT_REQUIRED', status: 409 });
    if (row.localAgent.status === 'provisioned') throw Object.assign(new Error('already'), { code: 'VF_ONBOARDING_LOCAL_AGENT_ALREADY_PROVISIONED', status: 409 });
    row.localAgent.status = 'provisioning';
    row.localAgent.installationId = installationId;
    row.localAgent.lastErrorCode = null;
    row.updatedAt = now;
    return this.clone(row);
  }

  async finalizeLocalAgent({ organizationId, profileId, installationId, now }) {
    const row = this.rows.get(this.key(organizationId, profileId));
    if (!row || row.localAgent.installationId !== installationId) {
      throw Object.assign(new Error('conflict'), { code: 'VF_ONBOARDING_LOCAL_AGENT_FINALIZE_CONFLICT', status: 409 });
    }
    row.localAgent.status = 'provisioned';
    row.localAgent.lastErrorCode = null;
    row.updatedAt = now;
    return this.clone(row);
  }

  async failLocalAgent({ organizationId, profileId, installationId, errorCode, now }) {
    const row = this.rows.get(this.key(organizationId, profileId));
    if (row && row.localAgent.installationId === installationId) {
      row.localAgent.status = 'error';
      row.localAgent.lastErrorCode = errorCode;
      row.updatedAt = now;
    }
    return this.clone(row);
  }
}

function authConfig() {
  return {
    credentials: [
      {
        id: 'tenant-a-onboarding',
        type: 'bearer',
        tokenSha256: hashBearerToken(tokenA),
        organizationId: 'org-a',
        installationId: 'kairoseth-ui',
        sourceSystem: 'kairoseth',
        rateLimitPerMinute: 1000,
        permissions: ['onboarding:manage'],
      },
      {
        id: 'tenant-b-onboarding',
        type: 'bearer',
        tokenSha256: hashBearerToken(tokenB),
        organizationId: 'org-b',
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
  return `http://127.0.0.1:${address.port}`;
}

async function request(baseUrl, token, path, { method = 'GET', body } = {}) {
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

test('onboarding profiles are tenant-bound and can safely provision Local Agent', async () => {
  let now = Date.UTC(2026, 9, 3, 21, 30, 0);
  const onboardingProfileStore = new MemoryOnboardingStore();
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    observabilityClock: () => now,
    onboardingProfileStore,
  });

  try {
    const baseUrl = await listen(runtime);

    const created = await request(baseUrl, tokenA, '/v1/control-plane/onboarding/profiles', {
      method: 'POST',
      body: {
        label: 'ERP principal',
        capabilities: {
          locale: 'es',
          canReadDatabase: true,
        },
      },
    });
    assert.equal(created.response.status, 201);
    assert.match(created.body.profileId, /^onb_[a-f0-9]{32}$/);
    assert.equal(created.body.organizationId, 'org-a');
    assert.equal(created.body.strategy.channel, 'database_read');
    assert.equal(created.body.strategy.requiresLocalAgent, true);
    assert.equal(created.body.integrationDraft.tenantBound, true);
    assert.equal(created.body.integrationDraft.fiscalAuthority, 'kairoseth');
    assert.equal(created.body.localAgent.status, 'not-provisioned');
    const profileId = created.body.profileId;

    const spoof = await request(baseUrl, tokenA, '/v1/control-plane/onboarding/profiles', {
      method: 'POST',
      body: {
        organizationId: 'org-b',
        capabilities: { hasApi: true },
      },
    });
    assert.equal(spoof.response.status, 400);
    assert.equal(spoof.body.error.code, 'VF_ONBOARDING_PROFILE_INPUT_UNKNOWN');

    const listA = await request(baseUrl, tokenA, '/v1/control-plane/onboarding/profiles');
    assert.equal(listA.response.status, 200);
    assert.equal(listA.body.profiles.length, 1);
    assert.equal(listA.body.profiles[0].organizationId, 'org-a');

    const listB = await request(baseUrl, tokenB, '/v1/control-plane/onboarding/profiles');
    assert.equal(listB.response.status, 200);
    assert.deepEqual(listB.body.profiles, []);

    const crossTenant = await request(
      baseUrl,
      tokenB,
      `/v1/control-plane/onboarding/profiles/${profileId}`,
    );
    assert.equal(crossTenant.response.status, 404);

    now += 1000;
    const bound = await request(
      baseUrl,
      tokenA,
      `/v1/control-plane/onboarding/profiles/${profileId}/integration`,
      {
        method: 'PATCH',
        body: {
          mappingProfileId: 'map-erp-v1',
          integrationProfileId: 'int-erp-v1',
        },
      },
    );
    assert.equal(bound.response.status, 200);
    assert.equal(bound.body.integrationDraft.status, 'bound');
    assert.equal(bound.body.integrationDraft.mappingProfileId, 'map-erp-v1');
    assert.equal(bound.body.integrationDraft.integrationProfileId, 'int-erp-v1');

    const forbiddenIdentity = await request(
      baseUrl,
      tokenA,
      `/v1/control-plane/onboarding/profiles/${profileId}/provision-local-agent`,
      {
        method: 'POST',
        body: { installationId: 'attacker-choice' },
      },
    );
    assert.equal(forbiddenIdentity.response.status, 400);
    assert.equal(forbiddenIdentity.body.error.code, 'VF_ONBOARDING_PROVISIONING_INPUT_FORBIDDEN');

    now += 1000;
    const provision = await request(
      baseUrl,
      tokenA,
      `/v1/control-plane/onboarding/profiles/${profileId}/provision-local-agent`,
      { method: 'POST', body: {} },
    );
    assert.equal(provision.response.status, 201);
    assert.equal(provision.body.profile.organizationId, 'org-a');
    assert.equal(provision.body.profile.localAgent.status, 'provisioned');
    assert.match(provision.body.profile.localAgent.installationId, /^onb-[a-f0-9]{16}$/);
    assert.equal(provision.body.installation.organizationId, 'org-a');
    assert.equal(provision.body.installation.installationId, provision.body.profile.localAgent.installationId);
    assert.match(provision.body.credential.token, /^pvla_/);
    assert.equal(provision.body.credential.shownOnce, true);
    assert.equal(provision.body.tenantAuthority, 'kairoseth');
    assert.equal(provision.body.fiscalAuthority, 'kairoseth');

    const repeated = await request(
      baseUrl,
      tokenA,
      `/v1/control-plane/onboarding/profiles/${profileId}/provision-local-agent`,
      { method: 'POST', body: {} },
    );
    assert.equal(repeated.response.status, 409);
    assert.equal(repeated.body.error.code, 'VF_ONBOARDING_LOCAL_AGENT_ALREADY_PROVISIONED');

    const agent = await runtime.localAgents.get(
      'org-a',
      provision.body.profile.localAgent.installationId,
    );
    assert.equal(agent.organizationId, 'org-a');

    const serialized = JSON.stringify(await onboardingProfileStore.get('org-a', profileId)).toLowerCase();
    for (const secretName of ['apikey', 'password', 'privatekey', 'certificate', 'tokensha256']) {
      assert.equal(serialized.includes(secretName), false);
    }
  } finally {
    await runtime.close();
  }
});

test('manual onboarding profiles cannot provision a Local Agent', async () => {
  const onboardingProfileStore = new MemoryOnboardingStore();
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    onboardingProfileStore,
  });

  try {
    const baseUrl = await listen(runtime);
    const created = await request(baseUrl, tokenA, '/v1/control-plane/onboarding/profiles', {
      method: 'POST',
      body: {
        capabilities: { locale: 'es' },
      },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.strategy.channel, 'manual');
    assert.equal(created.body.localAgent.status, 'not-required');

    const provision = await request(
      baseUrl,
      tokenA,
      `/v1/control-plane/onboarding/profiles/${created.body.profileId}/provision-local-agent`,
      { method: 'POST', body: {} },
    );
    assert.equal(provision.response.status, 409);
    assert.equal(provision.body.error.code, 'VF_ONBOARDING_LOCAL_AGENT_NOT_REQUIRED');
  } finally {
    await runtime.close();
  }
});
