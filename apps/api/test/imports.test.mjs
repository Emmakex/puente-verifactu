import test from 'node:test';
import assert from 'node:assert/strict';
import { FiscalRecordService } from '../../../packages/core/src/fiscal-record-service.mjs';
import { UniversalBridgeService } from '../src/service.mjs';
import { ImportSessionService } from '../src/imports.mjs';
import { MemoryImportBatchStore } from '../src/import-batch-store.mjs';
import { createApiHandler } from '../src/handler.mjs';

const context = {
  organizationId: 'org-demo',
  installationId: 'install-file',
  sourceSystem: 'file-upload',
};

const sif = {
  systemId: 'PV',
  installationNumber: '001',
  timeZone: 'Europe/Madrid',
};

const csv = Buffer.from([
  'Nº Factura;Fecha factura;Concepto;Base imponible;Cuota IVA;Total factura',
  'A-1;15/09/2026;Servicio mensual;100,00;21,00;121,00',
].join('\n'));

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

function realBridge() {
  const fiscalService = new FiscalRecordService({
    sif,
    clock: () => new Date('2026-09-15T09:00:00Z'),
  });
  return new UniversalBridgeService({ fiscalService });
}

test('temporary import session inspects CSV and runs a dry preflight', async () => {
  const imports = new ImportSessionService({
    clock: () => Date.parse('2026-09-15T09:00:00Z'),
  });
  const inspection = await imports.inspect({
    buffer: csv,
    filename: 'facturas.csv',
    context,
  });
  assert.match(inspection.importId, /^imp_[a-f0-9]{32}$/);
  assert.equal(inspection.file.rows, 1);
  assert.equal(inspection.assistant.profile.fields['Nº Factura'], 'number');
  assert.equal(
    inspection.assistant.missingEssentialTargets.includes('invoiceType'),
    true,
  );

  const report = await imports.preflight(
    inspection.importId,
    context,
    { configuration },
  );
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.ok, true);
  assert.deepEqual(report.summary, { rows: 1, valid: 1, invalid: 0 });
  assert.equal(report.profile.constants.organizationId, context.organizationId);
  assert.equal(report.profile.constants.installationId, context.installationId);
  assert.equal(report.profile.constants.invoiceType, 'F2');
  assert.match(report.preflightToken, /^[a-f0-9]{64}$/);
});

test('import session is tenant and installation isolated', async () => {
  const imports = new ImportSessionService();
  const inspection = await imports.inspect({
    buffer: csv,
    filename: 'facturas.csv',
    context,
  });
  await assert.rejects(
    () => imports.preflight(
      inspection.importId,
      { ...context, organizationId: 'org-other' },
      { configuration },
    ),
    { code: 'VF_IMPORT_SESSION_NOT_FOUND' },
  );
  await assert.rejects(
    () => imports.preflight(
      inspection.importId,
      { ...context, installationId: 'install-other' },
      { configuration },
    ),
    { code: 'VF_IMPORT_SESSION_NOT_FOUND' },
  );
});

test('reading at session capacity does not evict the active session', async () => {
  const imports = new ImportSessionService({ maxSessions: 1 });
  const inspection = await imports.inspect({
    buffer: csv,
    filename: 'facturas.csv',
    context,
  });
  const report = await imports.preflight(
    inspection.importId,
    context,
    { configuration },
  );
  assert.equal(report.ok, true);
});

test('expired import session returns an explicit expiration error', async () => {
  let now = 1000;
  const imports = new ImportSessionService({
    clock: () => now,
    ttlMs: 50,
  });
  const inspection = await imports.inspect({
    buffer: csv,
    filename: 'facturas.csv',
    context,
  });
  now = 1051;
  await assert.rejects(
    () => imports.preflight(
      inspection.importId,
      context,
      { configuration },
    ),
    { code: 'VF_IMPORT_SESSION_EXPIRED' },
  );
});

test('import API accepts raw file bytes and returns preflight through same-origin flow', async () => {
  const imports = new ImportSessionService();
  const handler = createApiHandler({
    bridge: {},
    imports,
    authenticate: async () => context,
  });
  const inspected = await handler({
    method: 'POST',
    path: '/v1/imports/inspect',
    headers: {
      'x-file-name': encodeURIComponent('facturas.csv'),
      'accept-language': 'es',
    },
    body: csv,
  });
  assert.equal(inspected.status, 201);
  assert.equal(inspected.body.file.format, 'csv');

  const preflight = await handler({
    method: 'POST',
    path: `/v1/imports/${inspected.body.importId}/preflight`,
    headers: { 'content-type': 'application/json' },
    body: { configuration },
  });
  assert.equal(preflight.status, 200);
  assert.equal(preflight.body.ok, true);
  assert.match(preflight.body.preflightToken, /^[a-f0-9]{64}$/);
});

test('unsupported fixed field is rejected rather than written into canonical profile', async () => {
  const imports = new ImportSessionService();
  const inspection = await imports.inspect({
    buffer: csv,
    filename: 'facturas.csv',
    context,
  });
  await assert.rejects(
    () => imports.preflight(
      inspection.importId,
      context,
      {
        configuration: {
          ...configuration,
          organizationId: 'attacker-org',
        },
      },
    ),
    { code: 'VF_IMPORT_CONFIGURATION_FIELD_INVALID' },
  );
});

test('confirmation freezes the exact successful preflight and is retry-safe', async () => {
  const batchStore = new MemoryImportBatchStore();
  const imports = new ImportSessionService({
    batchStore,
    bridge: realBridge(),
  });
  const inspection = await imports.inspect({
    buffer: csv,
    filename: 'facturas.csv',
    context,
  });
  const preflight = await imports.preflight(
    inspection.importId,
    context,
    { configuration },
  );

  await assert.rejects(
    () => imports.confirm(
      inspection.importId,
      context,
      {
        confirm: false,
        preflightToken: preflight.preflightToken,
      },
    ),
    { code: 'VF_IMPORT_CONFIRM_REQUIRED' },
  );
  await assert.rejects(
    () => imports.confirm(
      inspection.importId,
      context,
      {
        confirm: true,
        preflightToken: '0'.repeat(64),
      },
    ),
    { code: 'VF_IMPORT_PREFLIGHT_TOKEN_MISMATCH' },
  );

  const batch = await imports.confirm(
    inspection.importId,
    context,
    {
      confirm: true,
      preflightToken: preflight.preflightToken,
    },
  );
  assert.match(batch.batchId, /^bat_[a-f0-9]{32}$/);
  assert.equal(batch.state, 'confirmed');
  assert.deepEqual(batch.summary, {
    rows: 1,
    issued: 0,
    failed: 0,
    pending: 1,
  });
  assert.equal(batch.rows[0].status, 'pending');
  assert.equal(batch.rows[0].sourceInvoiceId, 'A-1');

  const retry = await imports.confirm(
    inspection.importId,
    context,
    {
      confirm: true,
      preflightToken: preflight.preflightToken,
    },
  );
  assert.equal(retry.batchId, batch.batchId);
  assert.equal(retry.preflightToken, batch.preflightToken);

  const stored = await batchStore.get(
    context.organizationId,
    context.installationId,
    batch.batchId,
  );
  assert.equal(stored.rows[0].intent.number, 'A-1');
  assert.equal(stored.rows[0].intent.organizationId, context.organizationId);
  assert.equal('buffer' in stored, false);
  assert.equal('binary' in stored, false);
});

test('confirmed batch issues idempotently, is resumable and exports per-row result', async () => {
  const batchStore = new MemoryImportBatchStore();
  const imports = new ImportSessionService({
    batchStore,
    bridge: realBridge(),
  });
  const inspection = await imports.inspect({
    buffer: csv,
    filename: 'facturas.csv',
    context,
  });
  const preflight = await imports.preflight(
    inspection.importId,
    context,
    { configuration },
  );
  const confirmed = await imports.confirm(
    inspection.importId,
    context,
    {
      confirm: true,
      preflightToken: preflight.preflightToken,
    },
  );

  const issued = await imports.issueBatch(confirmed.batchId, context);
  assert.equal(issued.state, 'completed');
  assert.equal(issued.duplicate, false);
  assert.deepEqual(issued.summary, {
    rows: 1,
    issued: 1,
    failed: 0,
    pending: 0,
  });
  assert.match(issued.rows[0].recordId, /^fr_[a-f0-9]{24}$/);

  const retry = await imports.issueBatch(confirmed.batchId, context);
  assert.equal(retry.state, 'completed');
  assert.equal(retry.duplicate, true);
  assert.equal(retry.rows[0].recordId, issued.rows[0].recordId);

  const history = await imports.listBatches(context);
  assert.equal(history.length, 1);
  assert.equal(history[0].batchId, confirmed.batchId);

  const exported = await imports.exportBatch(confirmed.batchId, context);
  assert.equal(exported.contentType, 'text/csv; charset=utf-8');
  assert.match(exported.filename, /-results\.csv$/);
  assert.match(exported.csv, /row,sourceInvoiceId,status,recordId,errorCode,retryable/);
  assert.match(exported.csv, /A-1,issued,fr_/);
});

test('partial batch retries only non-issued rows with stable row idempotency', async () => {
  const batchStore = new MemoryImportBatchStore();
  const seenKeys = [];
  let calls = 0;
  const bridge = {
    issue: async (_intent, _context, { idempotencyKey }) => {
      seenKeys.push(idempotencyKey);
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('temporary'), {
          code: 'VF_AEAT_UNAVAILABLE',
          status: 503,
        });
      }
      return { recordId: 'fr_' + 'a'.repeat(24) };
    },
  };
  const imports = new ImportSessionService({ batchStore, bridge });
  const inspection = await imports.inspect({
    buffer: csv,
    filename: 'facturas.csv',
    context,
  });
  const preflight = await imports.preflight(
    inspection.importId,
    context,
    { configuration },
  );
  const confirmed = await imports.confirm(
    inspection.importId,
    context,
    { confirm: true, preflightToken: preflight.preflightToken },
  );

  const first = await imports.issueBatch(confirmed.batchId, context);
  assert.equal(first.state, 'partial');
  assert.equal(first.rows[0].status, 'failed');
  assert.equal(first.rows[0].error.code, 'VF_AEAT_UNAVAILABLE');
  assert.equal(first.rows[0].error.retryable, true);

  const second = await imports.issueBatch(confirmed.batchId, context);
  assert.equal(second.state, 'completed');
  assert.equal(second.rows[0].status, 'issued');
  assert.equal(seenKeys.length, 2);
  assert.equal(seenKeys[0], seenKeys[1]);
  assert.equal(
    seenKeys[0],
    `import:${confirmed.batchId}:row:2`,
  );
});

test('batch history remains tenant and installation isolated', async () => {
  const batchStore = new MemoryImportBatchStore();
  const imports = new ImportSessionService({
    batchStore,
    bridge: realBridge(),
  });
  const inspection = await imports.inspect({
    buffer: csv,
    filename: 'facturas.csv',
    context,
  });
  const preflight = await imports.preflight(
    inspection.importId,
    context,
    { configuration },
  );
  const batch = await imports.confirm(
    inspection.importId,
    context,
    { confirm: true, preflightToken: preflight.preflightToken },
  );

  await assert.rejects(
    () => imports.batch(
      batch.batchId,
      { ...context, organizationId: 'org-other' },
    ),
    { code: 'VF_IMPORT_BATCH_NOT_FOUND' },
  );
  await assert.rejects(
    () => imports.batch(
      batch.batchId,
      { ...context, installationId: 'install-other' },
    ),
    { code: 'VF_IMPORT_BATCH_NOT_FOUND' },
  );
});
