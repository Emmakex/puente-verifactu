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

    const manualPage = await fetch(`${baseUrl}/manual.html`, {
      headers: { authorization: `Basic ${basic}` },
    });
    assert.equal(manualPage.status, 200);
    assert.match(await manualPage.text(), /Captura manual de factura/);
    assert.match(manualPage.headers.get('content-security-policy'), /default-src 'self'/);

    const manualModel = await fetch(`${baseUrl}/src/manual-model.mjs`, {
      headers: { authorization: `Basic ${basic}` },
    });
    assert.equal(manualModel.status, 200);
    assert.match(await manualModel.text(), /calculateManualVat/);

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


test('runtime rejects partial Kairoseth fiscal data-plane persistence injection', () => {
  assert.throws(
    () => createPuenteRuntime({
      databasePath: ':memory:',
      authConfig: authConfig(),
      sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
      fiscalRecordStore: {},
    }),
    /fiscalRecordStore and integrationDataStore must be injected together/,
  );
  assert.throws(
    () => createPuenteRuntime({
      databasePath: ':memory:',
      authConfig: authConfig(),
      sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
      integrationDataStore: {},
    }),
    /fiscalRecordStore and integrationDataStore must be injected together/,
  );
});


function kairosethRuntimeStores() {
  const sessions = new Map();
  const batches = new Map();
  const records = new Map();
  const requests = new Map();
  return {
    fiscalRecordStore: {
      async healthcheck() { return { ok: true }; },
      async executeOperation({ operationKey, fingerprint, createRecord }) {
        const existing = records.get(operationKey);
        if (existing) return { record: existing.record, duplicate: true };
        const record = createRecord(null);
        records.set(operationKey, { fingerprint, record });
        return { record, duplicate: false };
      },
    },
    integrationDataStore: {
      async reserve(key) {
        const existing = requests.get(key);
        if (existing) return { existing, duplicate: true };
        const pending = { fingerprint: 'test', recordId: null };
        requests.set(key, pending);
        return { existing: pending, duplicate: false };
      },
      async get(recordId) { return records.get(recordId)?.resource ?? null; },
      async put(record) {
        records.set(record.recordId, { resource: record });
        return record;
      },
      async complete(key, _payload, recordId) {
        requests.set(key, { fingerprint: 'test', recordId });
      },
      async release(key) { requests.delete(key); },
    },
    importSessionStore: {
      async purgeExpired() {},
      async ensureCapacity() {},
      async put(session) { sessions.set(session.importId, structuredClone(session)); return session; },
      async get(importId) { return structuredClone(sessions.get(importId) ?? null); },
      async delete(importId) { return sessions.delete(importId); },
    },
    importBatchStore: {
      async create(batch) { batches.set(batch.batchId, structuredClone(batch)); return batch; },
      async get(batchId) { return structuredClone(batches.get(batchId) ?? null); },
      async acquireLease() { return null; },
      async updateRow() { throw new Error('not used'); },
      async releaseLease() { throw new Error('not used'); },
    },
    localAgentRegistryStore: {
      async authByTokenSha256() { return null; },
      async create() { throw new Error('not used'); },
      async get() { return null; },
      async list() { return []; },
      async rotateCredential() { throw new Error('not used'); },
      async revoke() { throw new Error('not used'); },
      async setControl() { throw new Error('not used'); },
      async heartbeat() { throw new Error('not used'); },
    },
    aeatOutboxStore: {
      async stats() {
        return {
          total: 0,
          pending: 0,
          processing: 0,
          reconciliationRequired: 0,
          completed: 0,
          blocked: 0,
          duePending: 0,
          expiredProcessing: 0,
          oldestPendingAt: null,
          oldestPendingAgeMs: null,
          oldestReconciliationAt: null,
          oldestReconciliationAgeMs: null,
        };
      },
    },
    enqueueDelivery: async ({ recordId }) => ({
      status: 'queued',
      jobId: `aeat_${recordId}`,
      attempts: 0,
      retryable: true,
      reconciliationRequired: false,
    }),
    resolveDelivery: async (delivery) => delivery,
    onboardingProfileStore: {
      async create() { throw new Error('not used'); },
      async get() { return null; },
      async list() { return []; },
      async bindIntegration() { throw new Error('not used'); },
      async reserveLocalAgent() { throw new Error('not used'); },
      async finalizeLocalAgent() { throw new Error('not used'); },
      async failLocalAgent() { throw new Error('not used'); },
    },
    integrationProfileStore: {
      async create() { throw new Error('not used'); },
      async get() { return null; },
      async getInternal() { return null; },
      async findForContext() { return null; },
      async findByOnboarding() { return null; },
      async list() { return []; },
      async setMapping() { throw new Error('not used'); },
      async setWebhookSecretRef() { throw new Error('not used'); },
      async setAuthBinding() { throw new Error('not used'); },
      async disable() { throw new Error('not used'); },
    },
    resolveIntegrationSecretReference: async () => null,
    kairosethAuthProvider: {
      async resolveBearerDigest() { return null; },
    },
  };
}

test('kairoseth runtime starts without SQLite databasePath and uses injected health/backup providers', async () => {
  const stores = kairosethRuntimeStores();
  const runtime = createPuenteRuntime({
    persistenceMode: 'kairoseth',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    ...stores,
    backupStatusProvider: async () => ({
      configured: true,
      status: 'ok',
      createdAt: '2026-10-04T08:00:00.000Z',
      ageMs: 60_000,
    }),
  });

  try {
    assert.equal(runtime.persistenceMode, 'kairoseth');
    assert.equal(runtime.persistence.database, null);
    assert.equal(runtime.recoveredReservations, 0);
    const baseUrl = await listen(runtime);

    const ready = await fetch(baseUrl + '/readyz');
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, 'ready');

    const issueRequest = () => fetch(baseUrl + '/v1/fiscal-records', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
        'idempotency-key': 'runtime-kairoseth-async-store-1',
      },
      body: JSON.stringify({ intent: validIntent() }),
    });

    const issuedResponse = await issueRequest();
    assert.equal(issuedResponse.status, 202);
    const issued = await issuedResponse.json();
    assert.match(issued.recordId, /^fr_[a-f0-9]{24}$/);
    assert.equal(issued.duplicate, false);

    const retriedResponse = await issueRequest();
    assert.equal(retriedResponse.status, 200);
    const retried = await retriedResponse.json();
    assert.equal(retried.recordId, issued.recordId);
    assert.equal(retried.duplicate, true);

    const snapshot = await runtime.operationalObserver.snapshotAsync();
    assert.equal(snapshot.mode, 'kairoseth-mongodb');
    assert.equal(snapshot.database.ok, true);
    assert.equal(snapshot.backup.status, 'ok');
    assert.equal(snapshot.aeatOutbox.available, true);
    assert.equal(snapshot.summary.status, 'ok');
  } finally {
    await runtime.close();
  }
});

test('kairoseth runtime fails closed when a productive store or backup provider is missing', () => {
  const stores = kairosethRuntimeStores();
  const base = {
    persistenceMode: 'kairoseth',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    ...stores,
    backupStatusProvider: async () => ({
      configured: true,
      status: 'ok',
      createdAt: '2026-10-04T08:00:00.000Z',
      ageMs: 0,
    }),
  };

  for (const key of [
    'fiscalRecordStore',
    'integrationDataStore',
    'importSessionStore',
    'importBatchStore',
    'localAgentRegistryStore',
    'aeatOutboxStore',
    'onboardingProfileStore',
    'integrationProfileStore',
  ]) {
    assert.throws(
      () => createPuenteRuntime({ ...base, [key]: null }),
      new RegExp(key + ' is required'),
    );
  }

  assert.throws(
    () => createPuenteRuntime({ ...base, backupStatusProvider: null }),
    /backupStatusProvider is required/,
  );
  assert.throws(
    () => createPuenteRuntime({ ...base, enqueueDelivery: null }),
    /enqueueDelivery is required/,
  );
  assert.throws(
    () => createPuenteRuntime({ ...base, resolveDelivery: null }),
    /resolveDelivery is required/,
  );
  assert.throws(
    () => createPuenteRuntime({ ...base, resolveIntegrationSecretReference: null }),
    /resolveIntegrationSecretReference is required/,
  );
  assert.throws(
    () => createPuenteRuntime({ ...base, kairosethAuthProvider: null }),
    /kairosethAuthProvider is required/,
  );
});
