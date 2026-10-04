import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    issuer: { name: 'Empresa Demo', taxId: '89890001K' },
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


test('runtime issues presentation metadata using the configured AEAT environment', async () => {
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    presentationEnvironment: 'test',
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    clock: () => new Date('2026-09-15T09:00:00Z'),
  });

  try {
    const baseUrl = await listen(runtime);
    const response = await fetch(`${baseUrl}/v1/fiscal-records`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
        'idempotency-key': 'runtime-qr-1',
      },
      body: JSON.stringify({ intent: validIntent() }),
    });

    assert.equal(response.status, 202);
    const body = await response.json();
    assert.match(body.presentation.qr.url, /^https:\/\/prewww2\.aeat\.es\/wlpl\/TIKE-CONT\/ValidarQR\?/);
    assert.equal(body.presentation.qr.prefixText, 'QR tributario:');
    assert.equal(body.presentation.verificationText, 'Factura verificable en la sede electrónica de la AEAT');
  } finally {
    await runtime.close();
  }
});

test('runtime exposes configured responsible declaration only after authentication', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'puente-verifactu-declaration-'));
  const declarationPath = join(directory, 'declaracion.md');
  writeFileSync(declarationPath, '# DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN\n\nVersión 0.1.0\n');

  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    responsibleDeclarationPath: declarationPath,
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
  });

  try {
    const baseUrl = await listen(runtime);

    const unauthenticated = await fetch(`${baseUrl}/declaracion-responsable`);
    assert.equal(unauthenticated.status, 401);

    const basic = Buffer.from(`demo:${uiPassword}`).toString('base64');
    const response = await fetch(`${baseUrl}/declaracion-responsable`, {
      headers: { authorization: `Basic ${basic}` },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/plain/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-disposition'), /^inline/);
    assert.match(await response.text(), /DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN/);

    const head = await fetch(`${baseUrl}/declaracion-responsable`, {
      method: 'HEAD',
      headers: { authorization: `Basic ${basic}` },
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runtime fails closed when responsible declaration is not configured', async () => {
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
  });

  try {
    const baseUrl = await listen(runtime);
    const basic = Buffer.from(`demo:${uiPassword}`).toString('base64');
    const response = await fetch(`${baseUrl}/declaracion-responsable`, {
      headers: { authorization: `Basic ${basic}` },
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'VF_RESPONSIBLE_DECLARATION_NOT_CONFIGURED');
  } finally {
    await runtime.close();
  }
});


test('runtime rejects partial Kairoseth import persistence injection', () => {
  assert.throws(
    () => createPuenteRuntime({
      databasePath: ':memory:',
      authConfig: authConfig(),
      sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
      importSessionStore: {},
    }),
    /importSessionStore and importBatchStore must be injected together/,
  );
});

test('runtime serves confirmed import batch CSV export as raw text', async () => {
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    clock: () => new Date('2026-09-15T09:00:00Z'),
  });
  const basic = Buffer.from(`demo:${uiPassword}`).toString('base64');
  const csv = [
    'Nº Factura;Fecha factura;Concepto;Base imponible;Cuota IVA;Total factura',
    'HTTP-CSV-1;15/09/2026;Servicio CSV;100,00;21,00;121,00',
  ].join('\n');
  const configuration = {
    'issuer.name': 'Empresa Demo',
    'issuer.taxId': '89890001K',
    currency: 'EUR',
    'taxBreakdown.0.taxCode': '01',
    'taxBreakdown.0.regimeKey': '01',
    'taxBreakdown.0.operationClass': 'S1',
    'taxBreakdown.0.rate': '21',
    invoiceType: 'F2',
  };

  try {
    const baseUrl = await listen(runtime);
    const authHeaders = { authorization: `Basic ${basic}` };

    const inspected = await fetch(`${baseUrl}/v1/imports/inspect`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'x-file-name': encodeURIComponent('facturas.csv'),
        'content-type': 'application/octet-stream',
      },
      body: csv,
    });
    assert.equal(inspected.status, 201);
    const inspection = await inspected.json();

    const confirmed = await fetch(
      `${baseUrl}/v1/imports/${inspection.importId}/confirm`,
      {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ configuration }),
      },
    );
    assert.equal(confirmed.status, 201);
    const batch = await confirmed.json();

    const issued = await fetch(
      `${baseUrl}/v1/import-batches/${batch.batchId}/issue`,
      {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: '{}',
      },
    );
    assert.equal(issued.status, 202);
    assert.equal((await issued.json()).status, 'completed');

    const exported = await fetch(
      `${baseUrl}/v1/import-batches/${batch.batchId}/export`,
      {
        headers: { ...authHeaders, accept: 'text/csv' },
      },
    );
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type') ?? '', /^text\/csv/);
    assert.match(exported.headers.get('content-disposition') ?? '', /^attachment/);
    const text = await exported.text();
    assert.match(text, /^row,status,recordId,/);
    assert.equal(text.includes('89890001K'), false);
    assert.equal(text.includes('HTTP-CSV-1'), false);
  } finally {
    await runtime.close();
  }
});
