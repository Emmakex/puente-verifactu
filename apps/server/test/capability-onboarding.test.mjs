import test from 'node:test';
import assert from 'node:assert/strict';
import { hashBearerToken } from '../src/auth.mjs';
import { createPuenteRuntime } from '../src/runtime.mjs';

const managerToken = 'kairoseth-onboarding-manager';
const dataToken = 'normal-fiscal-data-plane';

function authConfig() {
  return {
    credentials: [
      {
        id: 'onboarding-manager',
        type: 'bearer',
        tokenSha256: hashBearerToken(managerToken),
        organizationId: 'kairoseth-control',
        installationId: 'control-plane',
        sourceSystem: 'kairoseth',
        rateLimitPerMinute: 1000,
        permissions: ['agents:manage'],
      },
      {
        id: 'normal-installation',
        type: 'bearer',
        tokenSha256: hashBearerToken(dataToken),
        organizationId: 'org-001',
        installationId: 'erp-001',
        sourceSystem: 'erp',
        rateLimitPerMinute: 1000,
        permissions: [],
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

async function post(baseUrl, token, body) {
  const response = await fetch(`${baseUrl}/v1/control-plane/onboarding/resolve`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test('Kairoseth onboarding endpoint resolves capabilities without returning secrets', async () => {
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
  });

  try {
    const baseUrl = await listen(runtime);
    const result = await post(baseUrl, managerToken, {
      locale: 'es',
      nativeConnector: 'unsupported-erp',
      canReadDatabase: true,
    });

    assert.equal(result.response.status, 200);
    assert.equal(result.body.channel, 'database_read');
    assert.equal(result.body.commercialFamily, 'connect');
    assert.equal(result.body.deploymentMode, 'local-agent');
    assert.equal(result.body.requiresLocalAgent, true);
    assert.equal(result.body.sourceKind, 'database');
    assert.equal(result.body.fiscalAuthority, 'kairoseth');
    assert.equal(result.body.autoIssue, false);
    assert.equal(result.body.autoProvision, false);
    assert.equal(result.body.returnsSecrets, false);
    assert.deepEqual(result.body.warnings, ['native_connector_not_supported']);

    const serialized = JSON.stringify(result.body).toLowerCase();
    for (const forbidden of ['apikey', 'password', 'privatekey', 'certificatepath', 'tokensha256']) {
      assert.equal(serialized.includes(forbidden), false);
    }
  } finally {
    await runtime.close();
  }
});

test('Kairoseth onboarding endpoint is unavailable to fiscal data-plane credentials', async () => {
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
  });

  try {
    const baseUrl = await listen(runtime);
    const result = await post(baseUrl, dataToken, { hasApi: true });
    assert.equal(result.response.status, 403);
    assert.equal(result.body.error.code, 'VF_API_FORBIDDEN');
  } finally {
    await runtime.close();
  }
});

test('Kairoseth onboarding endpoint rejects authority and fiscal fields', async () => {
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
  });

  try {
    const baseUrl = await listen(runtime);
    const tenantSpoof = await post(baseUrl, managerToken, {
      organizationId: 'other-org',
      hasApi: true,
    });
    assert.equal(tenantSpoof.response.status, 400);
    assert.equal(tenantSpoof.body.error.code, 'VF_ONBOARDING_AUTHORITY_FIELD_FORBIDDEN');

    const fiscalSpoof = await post(baseUrl, managerToken, {
      aeatEnvironment: 'production',
      canUploadFiles: true,
    });
    assert.equal(fiscalSpoof.response.status, 400);
    assert.equal(fiscalSpoof.body.error.code, 'VF_ONBOARDING_AUTHORITY_FIELD_FORBIDDEN');
  } finally {
    await runtime.close();
  }
});
