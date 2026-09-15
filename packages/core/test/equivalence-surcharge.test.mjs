import test from 'node:test';
import assert from 'node:assert/strict';
import { createAltaFiscalRecord } from '../src/fiscal-records.mjs';
import { validateInvoiceIntent } from '../src/validation.mjs';

function surchargeIntent() {
  return {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: 'org-retail',
    installationId: 'shop-1',
    sourceSystem: 'csv',
    sourceInvoiceId: 'sale-1',
    series: 'T-',
    number: '1',
    issueDate: '2026-09-15',
    invoiceType: 'F1',
    description: 'Venta minorista',
    issuer: { name: 'Proveedor SL', taxId: 'B12345678' },
    recipients: [{ name: 'Comercio SL', taxId: 'B87654321' }],
    currency: 'EUR',
    taxBreakdown: [{
      taxCode: '01',
      regimeKey: '01',
      operationClass: 'S1',
      rate: '21',
      baseAmount: '100.00',
      taxAmount: '21.00',
      surchargeRate: '5.2',
      surchargeAmount: '5.20',
    }],
    adjustments: [],
    totals: { baseAmount: '100.00', taxAmount: '21.00', totalAmount: '126.20' },
  };
}

test('line-level equivalence surcharge is valid and enters CuotaTotal once', () => {
  const intent = surchargeIntent();
  assert.equal(validateInvoiceIntent(intent).ok, true);
  const record = createAltaFiscalRecord(intent, {
    sif: { systemId: 'PV', installationNumber: '001' },
    generatedAt: '2026-09-15T10:00:00+02:00',
  });
  assert.equal(record.quotaTotal, '26.20');
  assert.equal(record.totalAmount, '126.20');
});

test('legacy aggregate surcharge may mirror line detail without double counting', () => {
  const intent = surchargeIntent();
  intent.adjustments = [{ type: 'surcharge', amount: '5.20' }];
  assert.equal(validateInvoiceIntent(intent).ok, true);
  const record = createAltaFiscalRecord(intent, {
    sif: { systemId: 'PV', installationNumber: '001' },
    generatedAt: '2026-09-15T10:00:00+02:00',
  });
  assert.equal(record.quotaTotal, '26.20');
});

test('aggregate surcharge mismatch is rejected', () => {
  const intent = surchargeIntent();
  intent.adjustments = [{ type: 'surcharge', amount: '4.00' }];
  const result = validateInvoiceIntent(intent);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'VF_VALIDATION_SURCHARGE_MISMATCH'));
});

test('surcharge rate and amount must travel together', () => {
  const intent = surchargeIntent();
  delete intent.taxBreakdown[0].surchargeAmount;
  const result = validateInvoiceIntent(intent);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'VF_VALIDATION_SURCHARGE_PAIR'));
});
