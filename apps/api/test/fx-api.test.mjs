import test from 'node:test';
import assert from 'node:assert/strict';
import { FiscalRecordService } from '../../../packages/core/src/fiscal-record-service.mjs';
import { createApiHandler } from '../src/handler.mjs';
import { FxAwareBridgeService } from '../src/fx-bridge.mjs';

const context = { organizationId: 'org-fx', installationId: 'woo-1', sourceSystem: 'woocommerce' };
const sif = { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' };

function invoice(overrides = {}) {
  return {
    schemaVersion: 1,
    operation: 'issue',
    sourceInvoiceId: 'woo:order:900',
    number: 'INV-900',
    issueDate: '2026-09-15',
    invoiceType: 'F1',
    description: 'Foreign currency order',
    issuer: { name: 'Demo issuer', taxId: 'TESTISSUER' },
    recipients: [{ name: 'Demo customer', taxId: 'TESTCUSTOMER' }],
    currency: 'USD',
    taxBreakdown: [{ taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '21', baseAmount: '100.00', taxAmount: '21.00' }],
    adjustments: [],
    totals: { baseAmount: '100.00', taxAmount: '21.00', totalAmount: '121.00' },
    ...overrides,
  };
}

function conversion(rate = '0.85') {
  return {
    schemaVersion: 1,
    sourceCurrency: 'USD',
    targetCurrency: 'EUR',
    eurPerUnit: rate,
    rateDate: '2026-09-15',
    rateSource: 'BANCO_DE_ESPANA',
    reference: `BDE:USD:2026-09-15:${rate}`,
  };
}

function setup(resolveEuroConversion) {
  const fiscalService = new FiscalRecordService({ sif, clock: () => new Date('2026-09-15T08:00:00Z') });
  const bridge = new FxAwareBridgeService({ fiscalService, resolveEuroConversion });
  const authenticate = async () => context;
  return { bridge, handler: createApiHandler({ bridge, authenticate }) };
}

test('preflight exposes commercial source and validated fiscal EUR preview', async () => {
  const { handler } = setup(() => conversion());
  const response = await handler({ method: 'POST', path: '/v1/preflight', body: { intent: invoice() }, headers: {} });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.sourcePreview.currency, 'USD');
  assert.equal(response.body.preview.currency, 'EUR');
  assert.equal(response.body.preview.totals.totalAmount, '102.85');
  assert.equal(response.body.currencyConversion.rateSource, 'BANCO_DE_ESPANA');
});

test('missing server-side rate blocks preflight without fiscal side effects', async () => {
  const { handler } = setup(() => null);
  const response = await handler({ method: 'POST', path: '/v1/preflight', body: { intent: invoice() }, headers: {} });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.errors[0].code, 'VF_VALIDATION_NON_EUR_CONVERSION_REQUIRED');
});

test('issue persists EUR fiscal amounts and conversion audit', async () => {
  const { handler } = setup(() => conversion());
  const request = {
    method: 'POST',
    path: '/v1/fiscal-records',
    body: { intent: invoice() },
    headers: { 'Idempotency-Key': 'fx-order-900' },
  };
  const first = await handler(request);
  assert.equal(first.status, 202);
  assert.equal(first.body.sourceCurrency, 'USD');
  assert.equal(first.body.fiscalCurrency, 'EUR');
  assert.equal(first.body.fiscalRecord.totalAmount, '102.85');
  assert.equal(first.body.currencyConversion.eurPerUnit, '0.85');

  const retry = await handler(request);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.recordId, first.body.recordId);
  assert.equal(retry.body.currencyConversion.reference, first.body.currencyConversion.reference);

  const stored = await handler({ method: 'GET', path: `/v1/fiscal-records/${first.body.recordId}`, headers: {} });
  assert.equal(stored.status, 200);
  assert.equal(stored.body.currencyConversion.rateDate, '2026-09-15');
});

test('same idempotency key conflicts if audited conversion changes', async () => {
  let rate = '0.85';
  const { handler } = setup(() => conversion(rate));
  const request = {
    method: 'POST',
    path: '/v1/fiscal-records',
    body: { intent: invoice() },
    headers: { 'Idempotency-Key': 'fx-rate-change' },
  };
  const first = await handler(request);
  assert.equal(first.status, 202);
  rate = '0.86';
  const second = await handler(request);
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'VF_API_IDEMPOTENCY_CONFLICT');
});
