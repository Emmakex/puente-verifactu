import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportSessionService } from '../src/imports.mjs';
import { MemoryImportBatchStore } from '../src/import-session-store.mjs';
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

test('temporary import session inspects CSV and runs a dry preflight', async () => {
  const imports = new ImportSessionService({ clock: () => Date.parse('2026-09-15T09:00:00Z') });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  assert.match(inspection.importId, /^imp_[a-f0-9]{32}$/);
  assert.equal(inspection.file.rows, 1);
  assert.equal(inspection.assistant.profile.fields['Nº Factura'], 'number');
  assert.equal(inspection.assistant.missingEssentialTargets.includes('invoiceType'), true);

  const report = await imports.preflight(inspection.importId, context, { configuration });
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.ok, true);
  assert.deepEqual(report.summary, { rows: 1, valid: 1, invalid: 0 });
  assert.equal(report.profile.constants.organizationId, context.organizationId);
  assert.equal(report.profile.constants.installationId, context.installationId);
  assert.equal(report.profile.constants.invoiceType, 'F2');
});

test('import session is tenant and installation isolated', async () => {
  const imports = new ImportSessionService();
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  await assert.rejects(
    imports.preflight(inspection.importId, { ...context, organizationId: 'org-other' }, { configuration }),
    { code: 'VF_IMPORT_SESSION_NOT_FOUND' },
  );
  await assert.rejects(
    imports.preflight(inspection.importId, { ...context, installationId: 'install-other' }, { configuration }),
    { code: 'VF_IMPORT_SESSION_NOT_FOUND' },
  );
});

test('reading at session capacity does not evict the active session', async () => {
  const imports = new ImportSessionService({ maxSessions: 1 });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  const report = await imports.preflight(inspection.importId, context, { configuration });
  assert.equal(report.ok, true);
});

test('expired import session returns an explicit expiration error', async () => {
  let now = 1000;
  const imports = new ImportSessionService({ clock: () => now, ttlMs: 50 });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  now = 1051;
  await assert.rejects(
    imports.preflight(inspection.importId, context, { configuration }),
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

test('unsupported fixed field is rejected rather than written into canonical profile', async () => {
  const imports = new ImportSessionService();
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  await assert.rejects(
    imports.preflight(inspection.importId, context, {
      configuration: { ...configuration, organizationId: 'attacker-org' },
    }),
    { code: 'VF_IMPORT_CONFIGURATION_FIELD_INVALID' },
  );
});


test('batch issuance requires explicit confirmation and is idempotent per frozen row', async () => {
  const imports = new ImportSessionService();
  const calls = [];
  const seen = new Map();
  const bridge = {
    async issue(intent, receivedContext, { idempotencyKey }) {
      calls.push({ intent, receivedContext, idempotencyKey });
      if (seen.has(idempotencyKey)) {
        return { ...seen.get(idempotencyKey), duplicate: true };
      }
      const resource = {
        recordId: `fr_${String(seen.size + 1).padStart(2, '0')}`,
        status: 'pending',
        duplicate: false,
      };
      seen.set(idempotencyKey, resource);
      return resource;
    },
  };
  const handler = createApiHandler({ bridge, imports, authenticate: async () => context });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });

  const direct = await handler({
    method: 'POST',
    path: `/v1/imports/${inspection.importId}/issue`,
    headers: { 'content-type': 'application/json' },
    body: { configuration },
  });
  assert.equal(direct.status, 409);
  assert.equal(direct.body.error.code, 'VF_IMPORT_CONFIRMATION_REQUIRED');
  assert.equal(calls.length, 0);

  const confirmed = await handler({
    method: 'POST',
    path: `/v1/imports/${inspection.importId}/confirm`,
    headers: { 'content-type': 'application/json' },
    body: { configuration },
  });
  assert.equal(confirmed.status, 201);

  const first = await handler({
    method: 'POST',
    path: `/v1/import-batches/${confirmed.body.batchId}/issue`,
    headers: { 'content-type': 'application/json' },
    body: {},
  });
  assert.equal(first.status, 202);
  assert.equal(first.body.status, 'completed');
  assert.equal(first.body.summary.issued, 1);
  assert.match(calls[0].idempotencyKey, new RegExp(`^${inspection.importId}:row:2import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportSessionService } from '../src/imports.mjs';
import { MemoryImportBatchStore } from '../src/import-session-store.mjs';
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

test('temporary import session inspects CSV and runs a dry preflight', async () => {
  const imports = new ImportSessionService({ clock: () => Date.parse('2026-09-15T09:00:00Z') });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  assert.match(inspection.importId, /^imp_[a-f0-9]{32}$/);
  assert.equal(inspection.file.rows, 1);
  assert.equal(inspection.assistant.profile.fields['Nº Factura'], 'number');
  assert.equal(inspection.assistant.missingEssentialTargets.includes('invoiceType'), true);

  const report = await imports.preflight(inspection.importId, context, { configuration });
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.ok, true);
  assert.deepEqual(report.summary, { rows: 1, valid: 1, invalid: 0 });
  assert.equal(report.profile.constants.organizationId, context.organizationId);
  assert.equal(report.profile.constants.installationId, context.installationId);
  assert.equal(report.profile.constants.invoiceType, 'F2');
});

test('import session is tenant and installation isolated', async () => {
  const imports = new ImportSessionService();
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  await assert.rejects(
    imports.preflight(inspection.importId, { ...context, organizationId: 'org-other' }, { configuration }),
    { code: 'VF_IMPORT_SESSION_NOT_FOUND' },
  );
  await assert.rejects(
    imports.preflight(inspection.importId, { ...context, installationId: 'install-other' }, { configuration }),
    { code: 'VF_IMPORT_SESSION_NOT_FOUND' },
  );
});

test('reading at session capacity does not evict the active session', async () => {
  const imports = new ImportSessionService({ maxSessions: 1 });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  const report = await imports.preflight(inspection.importId, context, { configuration });
  assert.equal(report.ok, true);
});

test('expired import session returns an explicit expiration error', async () => {
  let now = 1000;
  const imports = new ImportSessionService({ clock: () => now, ttlMs: 50 });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  now = 1051;
  await assert.rejects(
    imports.preflight(inspection.importId, context, { configuration }),
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

test('unsupported fixed field is rejected rather than written into canonical profile', async () => {
  const imports = new ImportSessionService();
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  await assert.rejects(
    imports.preflight(inspection.importId, context, {
      configuration: { ...configuration, organizationId: 'attacker-org' },
    }),
    { code: 'VF_IMPORT_CONFIGURATION_FIELD_INVALID' },
  );
});


test('batch issuance requires explicit confirmation and is idempotent per frozen row', async () => {
  const imports = new ImportSessionService();
  const calls = [];
  const seen = new Map();
  const bridge = {
    async issue(intent, receivedContext, { idempotencyKey }) {
      calls.push({ intent, receivedContext, idempotencyKey });
      if (seen.has(idempotencyKey)) {
        return { ...seen.get(idempotencyKey), duplicate: true };
      }
      const resource = {
        recordId: `fr_${String(seen.size + 1).padStart(2, '0')}`,
        status: 'pending',
        duplicate: false,
      };
      seen.set(idempotencyKey, resource);
      return resource;
    },
  };
  const handler = createApiHandler({ bridge, imports, authenticate: async () => context });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });

  const direct = await handler({
    method: 'POST',
    path: `/v1/imports/${inspection.importId}/issue`,
    headers: { 'content-type': 'application/json' },
    body: { configuration },
  });
  assert.equal(direct.status, 409);
  assert.equal(direct.body.error.code, 'VF_IMPORT_CONFIRMATION_REQUIRED');
  assert.equal(calls.length, 0);

  const confirmed = await handler({
    method: 'POST',
    path: `/v1/imports/${inspection.importId}/confirm`,
    headers: { 'content-type': 'application/json' },
    body: { configuration },
  });
  assert.equal(confirmed.status, 201);

  const first = await handler({
    method: 'POST',
    path: `/v1/import-batches/${confirmed.body.batchId}/issue`,
    headers: { 'content-type': 'application/json' },
    body: {},
  });
  assert.equal(first.status, 202);
  assert.equal(first.body.status, 'completed');
  assert.equal(first.body.summary.issued, 1);
  assert.match(calls[0].idempotencyKey, new RegExp(`^${inspection.importId}:row:2import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportSessionService } from '../src/imports.mjs';
import { MemoryImportBatchStore } from '../src/import-session-store.mjs';
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

test('temporary import session inspects CSV and runs a dry preflight', async () => {
  const imports = new ImportSessionService({ clock: () => Date.parse('2026-09-15T09:00:00Z') });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  assert.match(inspection.importId, /^imp_[a-f0-9]{32}$/);
  assert.equal(inspection.file.rows, 1);
  assert.equal(inspection.assistant.profile.fields['Nº Factura'], 'number');
  assert.equal(inspection.assistant.missingEssentialTargets.includes('invoiceType'), true);

  const report = await imports.preflight(inspection.importId, context, { configuration });
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.ok, true);
  assert.deepEqual(report.summary, { rows: 1, valid: 1, invalid: 0 });
  assert.equal(report.profile.constants.organizationId, context.organizationId);
  assert.equal(report.profile.constants.installationId, context.installationId);
  assert.equal(report.profile.constants.invoiceType, 'F2');
});

test('import session is tenant and installation isolated', async () => {
  const imports = new ImportSessionService();
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  await assert.rejects(
    imports.preflight(inspection.importId, { ...context, organizationId: 'org-other' }, { configuration }),
    { code: 'VF_IMPORT_SESSION_NOT_FOUND' },
  );
  await assert.rejects(
    imports.preflight(inspection.importId, { ...context, installationId: 'install-other' }, { configuration }),
    { code: 'VF_IMPORT_SESSION_NOT_FOUND' },
  );
});

test('reading at session capacity does not evict the active session', async () => {
  const imports = new ImportSessionService({ maxSessions: 1 });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  const report = await imports.preflight(inspection.importId, context, { configuration });
  assert.equal(report.ok, true);
});

test('expired import session returns an explicit expiration error', async () => {
  let now = 1000;
  const imports = new ImportSessionService({ clock: () => now, ttlMs: 50 });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  now = 1051;
  await assert.rejects(
    imports.preflight(inspection.importId, context, { configuration }),
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

test('unsupported fixed field is rejected rather than written into canonical profile', async () => {
  const imports = new ImportSessionService();
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  await assert.rejects(
    imports.preflight(inspection.importId, context, {
      configuration: { ...configuration, organizationId: 'attacker-org' },
    }),
    { code: 'VF_IMPORT_CONFIGURATION_FIELD_INVALID' },
  );
});


test('batch issuance requires explicit confirmation and is idempotent per frozen row', async () => {
  const imports = new ImportSessionService();
  const calls = [];
  const seen = new Map();
  const bridge = {
    async issue(intent, receivedContext, { idempotencyKey }) {
      calls.push({ intent, receivedContext, idempotencyKey });
      if (seen.has(idempotencyKey)) {
        return { ...seen.get(idempotencyKey), duplicate: true };
      }
      const resource = {
        recordId: `fr_${String(seen.size + 1).padStart(2, '0')}`,
        status: 'pending',
        duplicate: false,
      };
      seen.set(idempotencyKey, resource);
      return resource;
    },
  };
  const handler = createApiHandler({ bridge, imports, authenticate: async () => context });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });

  const direct = await handler({
    method: 'POST',
    path: `/v1/imports/${inspection.importId}/issue`,
    headers: { 'content-type': 'application/json' },
    body: { configuration },
  });
  assert.equal(direct.status, 409);
  assert.equal(direct.body.error.code, 'VF_IMPORT_CONFIRMATION_REQUIRED');
  assert.equal(calls.length, 0);

  const confirmed = await handler({
    method: 'POST',
    path: `/v1/imports/${inspection.importId}/confirm`,
    headers: { 'content-type': 'application/json' },
    body: { configuration },
  });
  assert.equal(confirmed.status, 201);

  const first = await handler({
    method: 'POST',
    path: `/v1/import-batches/${confirmed.body.batchId}/issue`,
    headers: { 'content-type': 'application/json' },
    body: {},
  });
  assert.equal(first.status, 202);
  assert.equal(first.body.status, 'completed');
  assert.equal(first.body.summary.issued, 1);
  assert.match(calls[0].idempotencyKey, new RegExp(`^${inspection.importId}:row:2import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportSessionService } from '../src/imports.mjs';
import { MemoryImportBatchStore } from '../src/import-session-store.mjs';
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

test('temporary import session inspects CSV and runs a dry preflight', async () => {
  const imports = new ImportSessionService({ clock: () => Date.parse('2026-09-15T09:00:00Z') });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  assert.match(inspection.importId, /^imp_[a-f0-9]{32}$/);
  assert.equal(inspection.file.rows, 1);
  assert.equal(inspection.assistant.profile.fields['Nº Factura'], 'number');
  assert.equal(inspection.assistant.missingEssentialTargets.includes('invoiceType'), true);

  const report = await imports.preflight(inspection.importId, context, { configuration });
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.ok, true);
  assert.deepEqual(report.summary, { rows: 1, valid: 1, invalid: 0 });
  assert.equal(report.profile.constants.organizationId, context.organizationId);
  assert.equal(report.profile.constants.installationId, context.installationId);
  assert.equal(report.profile.constants.invoiceType, 'F2');
});

test('import session is tenant and installation isolated', async () => {
  const imports = new ImportSessionService();
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  await assert.rejects(
    imports.preflight(inspection.importId, { ...context, organizationId: 'org-other' }, { configuration }),
    { code: 'VF_IMPORT_SESSION_NOT_FOUND' },
  );
  await assert.rejects(
    imports.preflight(inspection.importId, { ...context, installationId: 'install-other' }, { configuration }),
    { code: 'VF_IMPORT_SESSION_NOT_FOUND' },
  );
});

test('reading at session capacity does not evict the active session', async () => {
  const imports = new ImportSessionService({ maxSessions: 1 });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  const report = await imports.preflight(inspection.importId, context, { configuration });
  assert.equal(report.ok, true);
});

test('expired import session returns an explicit expiration error', async () => {
  let now = 1000;
  const imports = new ImportSessionService({ clock: () => now, ttlMs: 50 });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  now = 1051;
  await assert.rejects(
    imports.preflight(inspection.importId, context, { configuration }),
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

test('unsupported fixed field is rejected rather than written into canonical profile', async () => {
  const imports = new ImportSessionService();
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  await assert.rejects(
    imports.preflight(inspection.importId, context, {
      configuration: { ...configuration, organizationId: 'attacker-org' },
    }),
    { code: 'VF_IMPORT_CONFIGURATION_FIELD_INVALID' },
  );
});
test('batch issuance requires explicit confirmation and is idempotent per frozen row', async () => {
  const imports = new ImportSessionService();
  const calls = [];
  const seen = new Map();
  const bridge = {
    async issue(intent, receivedContext, { idempotencyKey }) {
      calls.push({ intent, receivedContext, idempotencyKey });
      if (seen.has(idempotencyKey)) return { ...seen.get(idempotencyKey), duplicate: true };
      const resource = {
        recordId: `fr_${String(seen.size + 1).padStart(2, '0')}`,
        status: 'pending',
        duplicate: false,
      };
      seen.set(idempotencyKey, resource);
      return resource;
    },
  };
  const handler = createApiHandler({ bridge, imports, authenticate: async () => context });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });

  const direct = await handler({
    method: 'POST',
    path: `/v1/imports/${inspection.importId}/issue`,
    headers: { 'content-type': 'application/json' },
    body: { configuration },
  });
  assert.equal(direct.status, 409);
  assert.equal(direct.body.error.code, 'VF_IMPORT_CONFIRMATION_REQUIRED');
  assert.equal(calls.length, 0);

  const confirmed = await handler({
    method: 'POST',
    path: `/v1/imports/${inspection.importId}/confirm`,
    headers: { 'content-type': 'application/json' },
    body: { configuration },
  });
  assert.equal(confirmed.status, 201);

  const first = await handler({
    method: 'POST',
    path: `/v1/import-batches/${confirmed.body.batchId}/issue`,
    headers: { 'content-type': 'application/json' },
    body: {},
  });
  assert.equal(first.status, 202);
  assert.equal(first.body.status, 'completed');
  assert.equal(first.body.summary.issued, 1);
  assert.match(calls[0].idempotencyKey, new RegExp(`^${inspection.importId}:row:2$`));
  assert.equal(first.body.rows[0].recordId, 'fr_01');
  assert.equal('intent' in first.body.rows[0], false);

  const retry = await handler({
    method: 'POST',
    path: `/v1/import-batches/${confirmed.body.batchId}/issue`,
    headers: { 'content-type': 'application/json' },
    body: {},
  });
  assert.equal(retry.status, 202);
  assert.equal(retry.body.rows[0].recordId, first.body.rows[0].recordId);
  assert.equal(calls.length, 1);
});

test('batch confirmation refuses invalid rows before creating or issuing a batch', async () => {
  const imports = new ImportSessionService();
  let issueCalls = 0;
  const handler = createApiHandler({
    bridge: { async issue() { issueCalls += 1; return {}; } },
    imports,
    authenticate: async () => context,
  });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  const response = await handler({
    method: 'POST',
    path: `/v1/imports/${inspection.importId}/confirm`,
    headers: { 'content-type': 'application/json' },
    body: { configuration: { ...configuration, invoiceType: '' } },
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, 'VF_IMPORT_BATCH_PREFLIGHT_FAILED');
  assert.equal(issueCalls, 0);
});


test('explicit confirmation freezes a durable tenant-bound import batch', async () => {
  const imports = new ImportSessionService({
    clock: () => Date.parse('2026-09-15T09:00:00Z'),
  });
  const inspection = await imports.inspect({
    buffer: csv,
    filename: 'facturas.csv',
    context,
  });

  const confirmed = await imports.confirmBatch(
    inspection.importId,
    context,
    { configuration },
  );

  assert.match(confirmed.batchId, /^bat_[a-f0-9]{32}$/);
  assert.equal(confirmed.importId, inspection.importId);
  assert.equal(confirmed.status, 'confirmed');
  assert.deepEqual(confirmed.summary, {
    rows: 1,
    pending: 1,
    issued: 0,
    failed: 0,
  });
  assert.equal(confirmed.rows[0].row, 2);
  assert.equal(confirmed.rows[0].status, 'pending');
  assert.equal('intent' in confirmed.rows[0], false);
  assert.equal('profile' in confirmed, false);

  const repeated = await imports.confirmBatch(
    inspection.importId,
    context,
    { configuration },
  );
  assert.equal(repeated.batchId, confirmed.batchId);

  const fetched = await imports.batch(confirmed.batchId, context);
  assert.deepEqual(fetched, confirmed);

  await assert.rejects(
    imports.batch(confirmed.batchId, { ...context, organizationId: 'org-other' }),
    { code: 'VF_IMPORT_BATCH_NOT_FOUND' },
  );
});

test('confirm API requires full preflight before creating a batch', async () => {
  const imports = new ImportSessionService();
  const handler = createApiHandler({
    bridge: {},
    imports,
    authenticate: async () => context,
  });
  const inspection = await imports.inspect({
    buffer: csv,
    filename: 'facturas.csv',
    context,
  });

  const invalid = await handler({
    method: 'POST',
    path: `/v1/imports/${inspection.importId}/confirm`,
    headers: { 'content-type': 'application/json' },
    body: { configuration: { ...configuration, invoiceType: '' } },
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.code, 'VF_IMPORT_BATCH_PREFLIGHT_FAILED');

  const confirmed = await handler({
    method: 'POST',
    path: `/v1/imports/${inspection.importId}/confirm`,
    headers: { 'content-type': 'application/json' },
    body: { configuration },
  });
  assert.equal(confirmed.status, 201);
  assert.match(confirmed.body.batchId, /^bat_[a-f0-9]{32}$/);

  const fetched = await handler({
    method: 'GET',
    path: `/v1/import-batches/${confirmed.body.batchId}`,
    headers: {},
  });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.batchId, confirmed.body.batchId);
});


test('retryable row failure is sanitized and can resume safely', async () => {
  const imports = new ImportSessionService();
  let calls = 0;
  const bridge = {
    async issue() {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('sensitive upstream detail'), {
          code: 'VF_AEAT_UNAVAILABLE',
          status: 503,
          retryable: true,
          xml: '<secret/>',
        });
      }
      return {
        recordId: 'fr_retry',
        status: 'queued',
        duplicate: false,
      };
    },
  };

  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  const confirmed = await imports.confirmBatch(inspection.importId, context, { configuration });

  const first = await imports.issueBatch(confirmed.batchId, context, bridge);
  assert.equal(first.status, 'partial');
  assert.equal(first.rows[0].status, 'failed');
  assert.deepEqual(first.rows[0].error, {
    code: 'VF_AEAT_UNAVAILABLE',
    status: 503,
    retryable: true,
  });
  assert.equal(JSON.stringify(first).includes('sensitive upstream detail'), false);
  assert.equal(JSON.stringify(first).includes('<secret/>'), false);

  const resumed = await imports.issueBatch(confirmed.batchId, context, bridge);
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.rows[0].status, 'issued');
  assert.equal(resumed.rows[0].recordId, 'fr_retry');
  assert.equal(resumed.rows[0].attempts, 2);
  assert.equal(calls, 2);
});

test('non-retryable row failure remains terminal on later batch issue calls', async () => {
  const imports = new ImportSessionService();
  let calls = 0;
  const bridge = {
    async issue() {
      calls += 1;
      throw Object.assign(new Error('private validation detail'), {
        code: 'VF_API_VALIDATION_FAILED',
        status: 422,
      });
    },
  };

  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  const confirmed = await imports.confirmBatch(inspection.importId, context, { configuration });

  const first = await imports.issueBatch(confirmed.batchId, context, bridge);
  assert.equal(first.status, 'partial');
  assert.equal(first.rows[0].error.retryable, false);

  const second = await imports.issueBatch(confirmed.batchId, context, bridge);
  assert.equal(second.status, 'partial');
  assert.equal(second.rows[0].attempts, 1);
  assert.equal(calls, 1);
});

test('active batch lease prevents a second worker', async () => {
  let now = 1000;
  const batchStore = new MemoryImportBatchStore();
  const imports = new ImportSessionService({
    batchStore,
    clock: () => now,
    batchLeaseMs: 5000,
  });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  const confirmed = await imports.confirmBatch(inspection.importId, context, { configuration });

  const lease = batchStore.acquireLease({
    batchId: confirmed.batchId,
    organizationId: context.organizationId,
    installationId: context.installationId,
    leaseToken: 'lease_other',
    now,
    expiresAt: now + 5000,
  });
  assert.ok(lease);

  await assert.rejects(
    imports.issueBatch(confirmed.batchId, context, {
      async issue() {
        throw new Error('must not run');
      },
    }),
    { code: 'VF_IMPORT_BATCH_BUSY', status: 409 },
  );

  now += 5001;
  const resumed = await imports.issueBatch(confirmed.batchId, context, {
    async issue() {
      return { recordId: 'fr_after_lease', status: 'queued', duplicate: false };
    },
  });
  assert.equal(resumed.status, 'completed');
});

test('batch export is machine-readable and CSV never exposes frozen intents', async () => {
  const imports = new ImportSessionService();
  const handler = createApiHandler({
    bridge: {
      async issue() {
        return {
          recordId: 'fr_export',
          status: 'queued',
          duplicate: false,
        };
      },
    },
    imports,
    authenticate: async () => context,
  });
  const inspection = await imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
  const confirmed = await imports.confirmBatch(inspection.importId, context, { configuration });
  await imports.issueBatch(confirmed.batchId, context, {
    async issue() {
      return {
        recordId: 'fr_export',
        status: 'queued',
        duplicate: false,
      };
    },
  });

  const jsonExport = await handler({
    method: 'GET',
    path: `/v1/import-batches/${confirmed.batchId}/export`,
    headers: { accept: 'application/json' },
  });
  assert.equal(jsonExport.status, 200);
  assert.equal(jsonExport.body.rows[0].recordId, 'fr_export');
  assert.equal('intent' in jsonExport.body.rows[0], false);

  const csvExport = await handler({
    method: 'GET',
    path: `/v1/import-batches/${confirmed.batchId}/export`,
    headers: { accept: 'text/csv' },
  });
  assert.equal(csvExport.status, 200);
  assert.match(csvExport.headers['content-type'], /^text\/csv/);
  assert.match(csvExport.rawBody, /^row,status,recordId,/);
  assert.match(csvExport.rawBody, /fr_export/);
  assert.equal(csvExport.rawBody.includes('TESTISSUER'), false);
  assert.equal(csvExport.rawBody.includes('A-1'), false);
});
