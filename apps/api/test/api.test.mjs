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
    issuer: { name: 'Empresa Demo', taxId: '89890001K' },
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
  assert.equal(first.body.presentation.mode, 'VERI*FACTU');
  assert.equal(first.body.presentation.qr.prefixText, 'QR tributario:');
  assert.equal(first.body.presentation.qr.errorCorrection, 'M');
  assert.match(first.body.presentation.qr.url, /^https:\/\/prewww2\.aeat\.es\/wlpl\/TIKE-CONT\/ValidarQR\?/);
  assert.match(first.body.presentation.qr.url, /nif=89890001K/);
  assert.match(first.body.presentation.qr.url, /numserie=A-1/);
  assert.match(first.body.presentation.qr.url, /fecha=15-09-2026/);
  assert.match(first.body.presentation.qr.url, /importe=121\.00/);
  assert.equal(first.body.presentation.verificationText, 'Factura verificable en la sede electrónica de la AEAT');
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
  assert.equal(own.body.presentation.specificationVersion, '0.5.0');
  assert.equal(own.body.presentation.structuredInvoice.verificationUrlFieldRequired, true);

  const foreign = await handler({ method: 'GET', path: `/v1/fiscal-records/${created.body.recordId}`, headers: {}, authContext: { organizationId: 'org-2', installationId: 'source-install-2', sourceSystem: 'sdk-test' } });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error.code, 'VF_API_RECORD_NOT_FOUND');
});


test('status envelope includes presentation and cancellation is server-derived and idempotent', async () => {
  const { handler } = setup();
  const created = await handler({
    method: 'POST',
    path: '/v1/fiscal-records',
    body: { intent: invoice({ sourceInvoiceId: 'invoice-lifecycle', number: '90' }) },
    headers: { 'Idempotency-Key': 'evt-lifecycle-create' },
  });
  assert.equal(created.status, 202);

  const status = await handler({
    method: 'GET',
    path: `/v1/fiscal-records/${created.body.recordId}/status`,
    headers: {},
  });
  assert.equal(status.status, 200);
  assert.equal(status.body.schemaVersion, 1);
  assert.equal(status.body.recordId, created.body.recordId);
  assert.equal(status.body.operation, 'issue');
  assert.equal(status.body.status, 'fiscalized');
  assert.equal(status.body.sourceInvoiceId, 'invoice-lifecycle');
  assert.equal(status.body.sourceCancellationId, null);
  assert.equal(status.body.cancellationOfRecordId, null);
  assert.equal(status.body.fiscal.recordType, 'alta');
  assert.equal(status.body.fiscal.fiscalNumber, 'A-90');
  assert.equal(status.body.presentation.mode, 'VERI*FACTU');
  assert.equal(status.body.presentation.qr.prefixText, 'QR tributario:');
  assert.equal(status.body.delivery, null);
  assert.equal('fiscalRecord' in status.body, false);

  const missingKey = await handler({
    method: 'POST',
    path: `/v1/fiscal-records/${created.body.recordId}/cancel`,
    body: { sourceCancellationId: 'cancel-lifecycle-1' },
    headers: {},
  });
  assert.equal(missingKey.status, 400);
  assert.equal(missingKey.body.error.code, 'VF_API_IDEMPOTENCY_KEY_REQUIRED');

  const forbiddenFiscalIdentity = await handler({
    method: 'POST',
    path: `/v1/fiscal-records/${created.body.recordId}/cancel`,
    body: {
      sourceCancellationId: 'cancel-lifecycle-1',
      issuerTaxId: 'ATTACKER',
    },
    headers: { 'Idempotency-Key': 'evt-lifecycle-cancel-forbidden' },
  });
  assert.equal(forbiddenFiscalIdentity.status, 400);
  assert.equal(
    forbiddenFiscalIdentity.body.error.code,
    'VF_API_CANCELLATION_INPUT_FORBIDDEN',
  );

  const cancelRequest = {
    method: 'POST',
    path: `/v1/fiscal-records/${created.body.recordId}/cancel`,
    body: { sourceCancellationId: 'cancel-lifecycle-1' },
    headers: { 'Idempotency-Key': 'evt-lifecycle-cancel' },
  };
  const cancelled = await handler(cancelRequest);
  assert.equal(cancelled.status, 202);
  assert.match(cancelled.body.recordId, /^fr_[a-f0-9]{24}$/);
  assert.equal(cancelled.body.fiscalRecord.recordType, 'anulacion');
  assert.equal(cancelled.body.fiscalRecord.invoice.issuerTaxId, '89890001K');
  assert.equal(cancelled.body.fiscalRecord.invoice.fiscalNumber, 'A-90');
  assert.equal(cancelled.body.fiscalRecord.invoice.issueDate, '2026-09-15');
  assert.equal(cancelled.body.sourceCancellationId, 'cancel-lifecycle-1');
  assert.equal(cancelled.body.cancellationOfRecordId, created.body.recordId);
  assert.equal(cancelled.body.presentation, null);

  const retry = await handler(cancelRequest);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.recordId, cancelled.body.recordId);
  assert.equal(retry.body.duplicate, true);

  const cancellationStatus = await handler({
    method: 'GET',
    path: `/v1/fiscal-records/${cancelled.body.recordId}/status`,
    headers: {},
  });
  assert.equal(cancellationStatus.status, 200);
  assert.equal(cancellationStatus.body.operation, 'cancel');
  assert.equal(cancellationStatus.body.fiscal.recordType, 'anulacion');
  assert.equal(cancellationStatus.body.presentation, null);
  assert.equal(cancellationStatus.body.cancellationOfRecordId, created.body.recordId);
  assert.equal(cancellationStatus.body.sourceCancellationId, 'cancel-lifecycle-1');
});

test('cancellation cannot target a cancellation resource', async () => {
  const { handler } = setup();
  const created = await handler({
    method: 'POST',
    path: '/v1/fiscal-records',
    body: { intent: invoice({ sourceInvoiceId: 'invoice-cancel-twice', number: '91' }) },
    headers: { 'Idempotency-Key': 'evt-cancel-twice-create' },
  });
  const cancelled = await handler({
    method: 'POST',
    path: `/v1/fiscal-records/${created.body.recordId}/cancel`,
    body: { sourceCancellationId: 'cancel-twice-1' },
    headers: { 'Idempotency-Key': 'evt-cancel-twice-1' },
  });
  assert.equal(cancelled.status, 202);

  const secondCancel = await handler({
    method: 'POST',
    path: `/v1/fiscal-records/${cancelled.body.recordId}/cancel`,
    body: { sourceCancellationId: 'cancel-twice-2' },
    headers: { 'Idempotency-Key': 'evt-cancel-twice-2' },
  });
  assert.equal(secondCancel.status, 409);
  assert.equal(secondCancel.body.error.code, 'VF_API_CANCELLATION_SOURCE_INVALID');
});


test('public lifecycle responses sanitize delivery and reconciliation payloads', async () => {
  const fiscalService = new FiscalRecordService({
    sif,
    clock: () => new Date('2026-09-15T08:00:00Z'),
  });
  const bridge = new UniversalBridgeService({
    fiscalService,
    enqueueDelivery: async ({ operation = 'issue' } = {}) => ({
      id: `job-${operation}`,
      status: 'queued',
      attempts: 1,
      retryable: true,
      rawXml: '<soap>must-not-leak</soap>',
      rawResponse: '<aeat>must-not-leak</aeat>',
      reconciliation: {
        outcome: 'unresolved',
        received: false,
        shouldReissue: false,
        errorCode: 'WAIT',
        rawQueryResponse: '<query>must-not-leak</query>',
      },
    }),
  });
  const handler = createApiHandler({
    bridge,
    authenticate: async () => ({
      organizationId: 'org-1',
      installationId: 'source-install-1',
      sourceSystem: 'sdk-test',
    }),
  });

  const created = await handler({
    method: 'POST',
    path: '/v1/fiscal-records',
    body: { intent: invoice({ sourceInvoiceId: 'invoice-sanitize', number: '92' }) },
    headers: { 'Idempotency-Key': 'evt-sanitize-create' },
  });
  assert.equal(created.status, 202);
  assert.equal(created.body.delivery.status, 'queued');
  assert.equal(created.body.delivery.jobId, 'job-issue');
  assert.equal(created.body.delivery.reconciliation.outcome, 'unresolved');
  const serializedCreate = JSON.stringify(created.body);
  assert.equal(serializedCreate.includes('must-not-leak'), false);
  assert.equal(serializedCreate.includes('rawXml'), false);
  assert.equal(serializedCreate.includes('rawResponse'), false);
  assert.equal(serializedCreate.includes('rawQueryResponse'), false);

  const status = await handler({
    method: 'GET',
    path: `/v1/fiscal-records/${created.body.recordId}/status`,
    headers: {},
  });
  assert.equal(status.status, 200);
  const serializedStatus = JSON.stringify(status.body);
  assert.equal(serializedStatus.includes('must-not-leak'), false);
  assert.equal(serializedStatus.includes('rawXml'), false);
  assert.equal(status.body.delivery.reconciliation.shouldReissue, false);

  const cancelled = await handler({
    method: 'POST',
    path: `/v1/fiscal-records/${created.body.recordId}/cancel`,
    body: { sourceCancellationId: 'cancel-sanitize' },
    headers: { 'Idempotency-Key': 'evt-sanitize-cancel' },
  });
  assert.equal(cancelled.status, 202);
  assert.equal(cancelled.body.delivery.jobId, 'job-cancel');
  assert.equal(JSON.stringify(cancelled.body).includes('must-not-leak'), false);
});
