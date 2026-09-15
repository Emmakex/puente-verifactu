import test from 'node:test';
import assert from 'node:assert/strict';
import { convertInvoiceIntentToEuro } from '../src/euro-conversion.mjs';

function intent(overrides = {}) {
  return {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: 'org-fx',
    installationId: 'woo-1',
    sourceSystem: 'woocommerce',
    sourceInvoiceId: 'woo:1:order:900',
    number: 'INV-900',
    issueDate: '2026-09-15',
    invoiceType: 'F1',
    description: 'Foreign currency sale',
    issuer: { name: 'Demo issuer', taxId: 'TESTISSUER' },
    recipients: [{ name: 'Demo customer', taxId: 'TESTCUSTOMER' }],
    currency: 'USD',
    taxBreakdown: [{ taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '21', baseAmount: '100.00', taxAmount: '21.00' }],
    adjustments: [],
    totals: { baseAmount: '100.00', taxAmount: '21.00', totalAmount: '121.00' },
    ...overrides,
  };
}

function conversion(overrides = {}) {
  return {
    schemaVersion: 1,
    sourceCurrency: 'USD',
    targetCurrency: 'EUR',
    eurPerUnit: '0.85',
    rateDate: '2026-09-15',
    rateSource: 'BANCO_DE_ESPANA',
    reference: 'BDE:USD:2026-09-15',
    ...overrides,
  };
}

test('non-EUR intent becomes a validated EUR fiscal view with audit metadata', () => {
  const result = convertInvoiceIntentToEuro(intent(), conversion());
  assert.equal(result.fiscalIntent.currency, 'EUR');
  assert.equal(result.fiscalIntent.taxBreakdown[0].baseAmount, '85.00');
  assert.equal(result.fiscalIntent.taxBreakdown[0].taxAmount, '17.85');
  assert.deepEqual(result.fiscalIntent.totals, { baseAmount: '85.00', taxAmount: '17.85', totalAmount: '102.85' });
  assert.deepEqual(result.conversion, {
    schemaVersion: 1,
    sourceCurrency: 'USD',
    targetCurrency: 'EUR',
    eurPerUnit: '0.85',
    rateDate: '2026-09-15',
    rateSource: 'BANCO_DE_ESPANA',
    reference: 'BDE:USD:2026-09-15',
    method: 'rate',
    sourceTotal: '121.00',
    fiscalTotal: '102.85',
  });
});

test('conversion uses exact decimal half-up rounding including negative amounts', () => {
  const source = intent({
    invoiceType: 'R4',
    taxBreakdown: [{ taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '21', baseAmount: '-1.00', taxAmount: '-0.21' }],
    totals: { baseAmount: '-1.00', taxAmount: '-0.21', totalAmount: '-1.21' },
    rectification: { type: 'I', originalInvoices: [{ number: 'INV-1', issueDate: '2026-09-01' }] },
  });
  const result = convertInvoiceIntentToEuro(source, conversion({ eurPerUnit: '0.5' }));
  assert.equal(result.fiscalIntent.taxBreakdown[0].baseAmount, '-0.50');
  assert.equal(result.fiscalIntent.taxBreakdown[0].taxAmount, '-0.11');
  assert.equal(result.fiscalIntent.totals.totalAmount, '-0.61');
});

test('rounding mismatch blocks instead of silently moving cents', () => {
  const source = intent({
    taxBreakdown: [
      { taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '0', baseAmount: '0.01', taxAmount: '0.00' },
      { taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '0', baseAmount: '0.01', taxAmount: '0.00' },
    ],
    totals: { baseAmount: '0.02', taxAmount: '0.00', totalAmount: '0.02' },
  });
  assert.throws(
    () => convertInvoiceIntentToEuro(source, conversion({ eurPerUnit: '0.5' })),
    { code: 'VF_FX_ROUNDING_RECONCILIATION_REQUIRED' },
  );
});

test('audited explicit EUR amounts resolve a rounding mismatch without changing classification', () => {
  const source = intent({
    taxBreakdown: [
      { taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '0', baseAmount: '0.01', taxAmount: '0.00' },
      { taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '0', baseAmount: '0.01', taxAmount: '0.00' },
    ],
    totals: { baseAmount: '0.02', taxAmount: '0.00', totalAmount: '0.02' },
  });
  const result = convertInvoiceIntentToEuro(source, conversion({
    eurPerUnit: '0.5',
    fiscalAmounts: {
      taxBreakdown: [
        { baseAmount: '0.01', taxAmount: '0.00' },
        { baseAmount: '0.00', taxAmount: '0.00' },
      ],
      totals: { baseAmount: '0.01', taxAmount: '0.00', totalAmount: '0.01' },
    },
  }));
  assert.equal(result.conversion.method, 'explicit-amounts');
  assert.equal(result.fiscalIntent.taxBreakdown[0].taxCode, '01');
  assert.equal(result.fiscalIntent.totals.totalAmount, '0.01');
});

test('conversion rejects mismatched currency and missing audit reference', () => {
  assert.throws(() => convertInvoiceIntentToEuro(intent(), conversion({ sourceCurrency: 'GBP' })), { code: 'VF_FX_SOURCE_CURRENCY_MISMATCH' });
  assert.throws(() => convertInvoiceIntentToEuro(intent(), conversion({ reference: '' })), { code: 'VF_FX_RATE_REFERENCE_REQUIRED' });
});
