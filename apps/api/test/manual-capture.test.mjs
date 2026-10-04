import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiHandler } from '../src/handler.mjs';
import { manualCaptureIdempotencyKey, manualCaptureToIntent } from '../src/manual-capture.mjs';
import { UniversalBridgeService } from '../src/service.mjs';
import { FiscalRecordService } from '../../../packages/core/src/fiscal-record-service.mjs';

const sif = { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' };

function payload(overrides = {}) {
  return {
    series: 'M-',
    number: '100',
    issueDate: '2026-10-04',
    invoiceType: 'F2',
    description: 'Servicio profesional',
    issuer: { name: 'Empresa Demo', taxId: '89890001K' },
    tax: {
      rate: '21',
      baseAmount: '100.00',
      taxAmount: '21.00',
      totalAmount: '121.00',
    },
    ...overrides,
  };
}

function setup() {
  const fiscalService = new FiscalRecordService({
    sif,
    clock: () => new Date('2026-10-04T10:00:00Z'),
  });
  const bridge = new UniversalBridgeService({ fiscalService });
  const authenticate = async () => ({
    organizationId: 'org-manual',
    installationId: 'install-manual',
    sourceSystem: 'kairoseth-manual',
    permissions: [],
  });
  return createApiHandler({ bridge, authenticate });
}

test('manual capture maps only neutral user fields to a server-owned canonical intent', () => {
  const intent = manualCaptureToIntent(payload());
  assert.equal(intent.sourceInvoiceId, 'manual:2026-10-04:M-:100');
  assert.equal(intent.currency, 'EUR');
  assert.equal(intent.taxBreakdown[0].taxCode, '01');
  assert.equal(intent.taxBreakdown[0].regimeKey, '01');
  assert.equal(intent.taxBreakdown[0].operationClass, 'S1');
  assert.equal(intent.taxBreakdown[0].rate, '21');
  assert.equal(intent.totals.totalAmount, '121.00');
  assert.equal('organizationId' in intent, false);
  assert.equal('installationId' in intent, false);
  assert.equal('sourceSystem' in intent, false);
  assert.equal('certificate' in intent, false);
});

test('manual capture fails closed for authority injection and unsupported tax profiles', () => {
  assert.throws(
    () => manualCaptureToIntent({ ...payload(), organizationId: 'attacker' }),
    (error) => error.code === 'VF_MANUAL_FIELD_UNKNOWN',
  );
  assert.throws(
    () => manualCaptureToIntent({
      ...payload(),
      tax: { ...payload().tax, rate: '0' },
    }),
    (error) => error.code === 'VF_MANUAL_TAX_PROFILE_UNSUPPORTED' && error.status === 422,
  );
});

test('manual rectification requires customer and explicit I/S mode', () => {
  assert.throws(
    () => manualCaptureToIntent(payload({ invoiceType: 'R1' })),
    (error) => error.code === 'VF_MANUAL_FIELD_INVALID',
  );

  const intent = manualCaptureToIntent(payload({
    invoiceType: 'R1',
    recipient: { name: 'Cliente Demo', taxId: 'B12345678' },
    rectification: { type: 'I' },
  }));
  assert.equal(intent.invoiceType, 'R1');
  assert.equal(intent.recipients[0].taxId, 'B12345678');
  assert.deepEqual(intent.rectification, { type: 'I' });
});

test('manual idempotency key is deterministic for the fiscal document identity', () => {
  const first = manualCaptureIdempotencyKey(payload());
  const second = manualCaptureIdempotencyKey(payload({ description: 'Texto cambiado' }));
  assert.equal(first, 'manual-issue:2026-10-04:M-:100');
  assert.equal(second, first);
});

test('manual preflight is side-effect free and issuance is explicit and idempotent', async () => {
  const handler = setup();

  const preflight = await handler({
    method: 'POST',
    path: '/v1/manual/preflight',
    headers: {},
    body: payload(),
  });
  assert.equal(preflight.status, 200);
  assert.equal(preflight.body.ok, true);
  assert.equal(preflight.body.preview.organizationId, 'org-manual');
  assert.equal(preflight.body.preview.installationId, 'install-manual');
  assert.equal(preflight.body.preview.sourceSystem, 'kairoseth-manual');

  const issueRequest = {
    method: 'POST',
    path: '/v1/manual/fiscal-records',
    headers: {},
    body: payload(),
  };
  const issued = await handler(issueRequest);
  assert.equal(issued.status, 202);
  assert.match(issued.body.recordId, /^fr_[a-f0-9]{24}$/);
  assert.equal(issued.body.duplicate, false);
  assert.equal(issued.body.presentation.mode, 'VERI*FACTU');
  assert.match(issued.body.presentation.qr.url, /^https:\/\/prewww2\.aeat\.es\//);

  const retry = await handler(issueRequest);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.recordId, issued.body.recordId);
  assert.equal(retry.body.duplicate, true);
});

test('manual issuance rejects changed content under the same document identity', async () => {
  const handler = setup();
  const issued = await handler({
    method: 'POST',
    path: '/v1/manual/fiscal-records',
    headers: {},
    body: payload(),
  });
  assert.equal(issued.status, 202);

  const conflict = await handler({
    method: 'POST',
    path: '/v1/manual/fiscal-records',
    headers: {},
    body: payload({
      tax: {
        rate: '21',
        baseAmount: '200.00',
        taxAmount: '42.00',
        totalAmount: '242.00',
      },
    }),
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'VF_API_IDEMPOTENCY_CONFLICT');
});
