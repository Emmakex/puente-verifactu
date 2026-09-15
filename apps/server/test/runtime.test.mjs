import test from 'node:test';
import assert from 'node:assert/strict';
import { hashBasicPassword, hashBearerToken } from '../src/auth.mjs';
import { createIntegrationResolvers, validateIntegrationConfig } from '../src/integration-config.mjs';
import { createPuenteRuntime } from '../src/runtime.mjs';

const apiToken = 'runtime-test-token';
const uiPassword = 'runtime-ui-password';
const salt = '11'.repeat(16);

function authConfig() {
  return {
    credentials: [
      {
        id: 'runtime-api',
        type: 'bearer',
        tokenSha256: hashBearerToken(apiToken),
        organizationId: 'org-runtime',
        installationId: 'install-api',
        sourceSystem: 'runtime-api',
        rateLimitPerMinute: 2,
      },
      {
        id: 'runtime-ui',
        type: 'basic',
        username: 'demo',
        passwordSalt: salt,
        passwordScrypt: hashBasicPassword(uiPassword, salt),
        organizationId: 'org-runtime',
        installationId: 'install-ui',
        sourceSystem: 'file-upload',
        rateLimitPerMinute: 10,
      },
    ],
  };
}

function validIntent() {
  return {
    sourceInvoiceId: 'HTTP-1',
    number: '1',
    series: 'HTTP-',
    issueDate: '2026-09-15',
    invoiceType: 'F2',
    description: 'Servicio HTTP',
    issuer: { name: 'Empresa Demo', taxId: 'TESTISSUER' },
    currency: 'EUR',
    taxBreakdown: [{
      taxCode: '01',
      regimeKey: '01',
      operationClass: 'S1',
      rate: '21',
      baseAmount: '100.00',
      taxAmount: '21.00',
    }],
    totals: { baseAmount: '100.00', taxAmount: '21.00', totalAmount: '121.00' },
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

test('integration profiles are tenant and installation scoped', async () => {
  const config = validateIntegrationConfig({
    integrations: [{
      id: 'erp-v1',
      organizationId: 'org-a',
      installationId: 'install-a',
      webhookSecret: 'x'.repeat(32),
      mappingProfile: {
        profileVersion: 1,
        id: 'erp-v1',
        name: 'ERP v1',
        sourceType: 'api',
        fields: { numero: 'number' },
        transforms: {},
        constants: {},
        defaults: {},
      },
    }],
  });
  const resolver = createIntegrationResolvers(config);
  assert.ok(await resolver.resolveMappingProfile({ context: { organizationId: 'org-a', installationId: 'install-a' }, profileId: 'erp-v1' }));
  assert.equal(await resolver.resolveMappingProfile({ context: { organizationId: 'org-b', installationId: 'install-a' }, profileId: 'erp-v1' }), null);
  assert.equal(await resolver.resolveWebhookSecret({ context: { organizationId: 'org-a', installationId: 'other' }, profileId: 'erp-v1' }), null);
});

test('concrete runtime serves protected onboarding, API auth and rate limits', async () => {
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    clock: () => new Date('2026-09-15T09:00:00Z'),
  });
  try {
    const baseUrl = await listen(runtime);

    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');

    const ready = await fetch(`${baseUrl}/readyz`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, 'ready');

    const unauthenticated = await fetch(`${baseUrl}/`);
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get('www-authenticate'), /^Basic /);
    assert.equal((await unauthenticated.json()).error.code, 'VF_AUTH_REQUIRED');

    const basic = Buffer.from(`demo:${uiPassword}`).toString('base64');
    const onboarding = await fetch(`${baseUrl}/`, { headers: { authorization: `Basic ${basic}` } });
    assert.equal(onboarding.status, 200);
    assert.match(await onboarding.text(), /Puente VeriFactu/);
    assert.match(onboarding.headers.get('content-security-policy'), /default-src 'self'/);

    const request = () => fetch(`${baseUrl}/v1/preflight`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ intent: validIntent() }),
    });

    const first = await request();
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.preview.organizationId, 'org-runtime');
    assert.equal(firstBody.preview.installationId, 'install-api');
    assert.equal(firstBody.preview.sourceSystem, 'runtime-api');

    const second = await request();
    assert.equal(second.status, 200);
    const limited = await request();
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'VF_RATE_LIMITED');
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  } finally {
    await runtime.close();
  }
});
