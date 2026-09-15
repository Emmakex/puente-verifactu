import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportSessionService } from '../src/imports.mjs';
import { createApiHandler } from '../src/handler.mjs';

const context = {
  organizationId: 'org-demo',
  installationId: 'install-file',
  sourceSystem: 'file-upload',
};

const csv = Buffer.from([
  'Nº Factura;Fecha factura;Concepto;Base imponible;Cuota IVA;Total factura',
  'A-1;15/09/2026;Servicio mensual;100,00;21,00;121,00',
].join('\n'));

const configuration = {
  'issuer.name': 'Empresa Demo',
  'issuer.taxId': 'TESTISSUER',
  currency: 'EUR',
  'taxBreakdown.0.taxCode': '01',
  'taxBreakdown.0.regimeKey': '01',
  'taxBreakdown.0.operationClass': 'S1',
  'taxBreakdown.0.rate': '21',
  invoiceType: 'F2',
};

test('temporary import session inspects CSV and runs a dry preflight', () => {
  const imports = new ImportSessionService({ clock: () => Date.parse('2026-09-15T09:00:00Z') });
  const inspection = imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  assert.match(inspection.importId, /^imp_[a-f0-9]{32}$/);
  assert.equal(inspection.file.rows, 1);
  assert.equal(inspection.assistant.profile.fields['Nº Factura'], 'number');
  assert.equal(inspection.assistant.missingEssentialTargets.includes('invoiceType'), true);

  const report = imports.preflight(inspection.importId, context, { configuration });
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.ok, true);
  assert.deepEqual(report.summary, { rows: 1, valid: 1, invalid: 0 });
  assert.equal(report.profile.constants.organizationId, context.organizationId);
  assert.equal(report.profile.constants.installationId, context.installationId);
  assert.equal(report.profile.constants.invoiceType, 'F2');
});

test('import session is tenant and installation isolated', () => {
  const imports = new ImportSessionService();
  const inspection = imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  assert.throws(() => imports.preflight(inspection.importId, { ...context, organizationId: 'org-other' }, { configuration }), { code: 'VF_IMPORT_SESSION_NOT_FOUND' });
  assert.throws(() => imports.preflight(inspection.importId, { ...context, installationId: 'install-other' }, { configuration }), { code: 'VF_IMPORT_SESSION_NOT_FOUND' });
});

test('reading at session capacity does not evict the active session', () => {
  const imports = new ImportSessionService({ maxSessions: 1 });
  const inspection = imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  const report = imports.preflight(inspection.importId, context, { configuration });
  assert.equal(report.ok, true);
});

test('expired import session returns an explicit expiration error', () => {
  let now = 1000;
  const imports = new ImportSessionService({ clock: () => now, ttlMs: 50 });
  const inspection = imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  now = 1051;
  assert.throws(() => imports.preflight(inspection.importId, context, { configuration }), { code: 'VF_IMPORT_SESSION_EXPIRED' });
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
    headers: { 'x-file-name': encodeURIComponent('facturas.csv'), 'accept-language': 'es' },
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
});

test('unsupported fixed field is rejected rather than written into canonical profile', () => {
  const imports = new ImportSessionService();
  const inspection = imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  assert.throws(() => imports.preflight(inspection.importId, context, {
    configuration: { ...configuration, organizationId: 'attacker-org' },
  }), { code: 'VF_IMPORT_CONFIGURATION_FIELD_INVALID' });
});
