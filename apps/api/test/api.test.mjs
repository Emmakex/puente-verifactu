import test from 'node:test';
import assert from 'node:assert/strict';
import { FiscalRecordService } from '../../../packages/core/src/fiscal-record-service.mjs';
import { createApiHandler } from '../src/handler.mjs';
import { UniversalBridgeService } from '../src/service.mjs';

const sif = { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' };

function invoice(overrides = {}) {
  return {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: 'spoofed-org',
    installationId: 'spoofed-installation',
    sourceSystem: 'spoofed-source',
    sourceInvoiceId: 'invoice-1',
    series: 'A-',
    number: '1',
    issueDate: '2026-09-15',
    invoiceType: 'F2',
    description: 'Servicio de prueba',
    issuer: { name: 'Empresa Demo', taxId: 'TESTISSUER' },
    currency: 'EUR',
    taxBreakdown: [{ taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '21', baseAmount: '100.00', taxAmount: '21.00' }],
    adjustments: [],
    totals: { baseAmount: '100.00', taxAmount: '21.00', totalAmount: '121.00' },
    ...overrides,
  };
}

function setup() {
  const fiscalService = new FiscalRecordService({ sif, clock: () => new Date('2026-09-15T08:00:00Z') });
  const bridge = new UniversalBridgeService({ fiscalService });
  const authenticate = async (request) => request.authContext ?? { organizationId: 'org-1', installationId: 'source-install-1', sourceSystem: 'sdk-test' };
  return { bridge, handler: createApiHandler({ bridge, authenticate }) };
}

test('preflight overwrites client tenant/source identity', async () => {
  const { handler } = setup();
  const response = await handler({ method: 'POST', path: '/v1/preflight', body: { intent: invoice() }, headers: {} });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.preview.organizationId, 'org-1');
  assert.equal(response.body.preview.installationId, 'source-install-1');
  assert.equal(response.body.preview.sourceSystem, 'sdk-test');
});

test('issue requires idempotency key and retries return the same record', async () => {
  const { handler } = setup();
  const missing = await handler({ method: 'POST', path: '/v1/fiscal-records', body: { intent: invoice() }, headers: {} });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'VF_API_IDEMPOTENCY_KEY_REQUIRED');

  const request = { method: 'POST', path: '/v1/fiscal-records', body: { intent: invoice() }, headers: { 'Idempotency-Key': 'evt-1' } };
  const first = await handler(request);
  assert.equal(first.status, 202);
  assert.match(first.body.recordId, /^fr_[a-f0-9]{24}$/);
  const retry = await handler(request);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.recordId, first.body.recordId);
  assert.equal(retry.body.duplicate, true);
});

test('same idempotency key with changed content conflicts', async () => {
  const { handler } = setup();
  const headers = { 'Idempotency-Key': 'evt-conflict' };
  const first = await handler({ method: 'POST', path: '/v1/fiscal-records', body: { intent: invoice() }, headers });
  assert.equal(first.status, 202);
  const second = await handler({ method: 'POST', path: '/v1/fiscal-records', body: { intent: invoice({ number: '2', sourceInvoiceId: 'invoice-2' }) }, headers });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'VF_API_IDEMPOTENCY_CONFLICT');
});

test('record lookup never crosses organization boundaries', async () => {
  const { handler } = setup();
  const created = await handler({ method: 'POST', path: '/v1/fiscal-records', body: { intent: invoice() }, headers: { 'Idempotency-Key': 'evt-tenant' } });
  const own = await handler({ method: 'GET', path: `/v1/fiscal-records/${created.body.recordId}`, headers: {} });
  assert.equal(own.status, 200);

  const foreign = await handler({ method: 'GET', path: `/v1/fiscal-records/${created.body.recordId}`, headers: {}, authContext: { organizationId: 'org-2', installationId: 'source-install-2', sourceSystem: 'sdk-test' } });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error.code, 'VF_API_RECORD_NOT_FOUND');
});
