import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMapping, validateMappingProfile } from '../src/mapping.mjs';
import { validateInvoiceIntent } from '../src/validation.mjs';

const profile = {
  profileVersion: 1,
  id: 'woo-v1',
  name: 'WooCommerce v1',
  sourceType: 'native',
  fields: {
    invoice_number: 'number',
    order_date: 'issueDate',
    description: 'description',
    currency: 'currency',
    customer_name: 'recipients.0.name',
    customer_tax_id: 'recipients.0.taxId',
    total_amount: 'totals.totalAmount',
    source_invoice_id: 'sourceInvoiceId',
    tax_lines: 'taxBreakdown',
  },
  transforms: { currency: ['trim', 'upper'] },
  taxLineDefaults: { taxCode: '01', regimeKey: '01', operationClass: 'S1' },
  constants: {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: 'server-owned',
    installationId: 'server-owned',
    sourceSystem: 'woocommerce',
    invoiceType: 'F1',
    issuer: { name: 'Demo issuer', taxId: 'TESTISSUER' },
  },
  defaults: {},
};

function source(currency = 'EUR') {
  return {
    source_invoice_id: 'woo:1:order:10',
    invoice_number: 'INV-10',
    order_date: '2026-09-15',
    description: 'WooCommerce order 10',
    currency,
    customer_name: 'Demo customer',
    customer_tax_id: 'TESTCUSTOMER',
    total_amount: '154.00',
    tax_lines: [
      { rate: '21', baseAmount: '100.00', taxAmount: '21.00' },
      { rate: '10', baseAmount: '30.00', taxAmount: '3.00' },
    ],
  };
}

test('native tax lines preserve multiple rates while fiscal classification stays server-side', () => {
  const mapped = applyMapping(source(' eur '), profile);
  assert.equal(mapped.number, 'INV-10');
  assert.equal(mapped.currency, 'EUR');
  assert.equal(mapped.taxBreakdown.length, 2);
  assert.deepEqual(mapped.taxBreakdown[0], {
    taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '21', baseAmount: '100.00', taxAmount: '21.00',
  });
  assert.equal(mapped.totals.baseAmount, '130.00');
  assert.equal(mapped.totals.taxAmount, '24.00');
  assert.equal(validateInvoiceIntent(mapped).ok, true);
});

test('non-EUR native input is preserved but blocked before fiscalization until explicit EUR conversion exists', () => {
  const mapped = applyMapping(source(' usd '), profile);
  assert.equal(mapped.currency, 'USD');
  const validation = validateInvoiceIntent(mapped);
  assert.equal(validation.ok, false);
  assert.equal(validation.errors.some((item) => item.code === 'VF_VALIDATION_NON_EUR_CONVERSION_REQUIRED'), true);
});

test('native source cannot inject fiscal classification into tax lines', () => {
  assert.throws(() => applyMapping({
    invoice_number: 'INV-10',
    tax_lines: [{ rate: '21', baseAmount: '100.00', taxAmount: '21.00', regimeKey: '99' }],
  }, profile), /Unsupported native tax line field regimeKey/);
});

test('native tax mapping requires server-side tax line defaults', () => {
  const invalid = structuredClone(profile);
  delete invalid.taxLineDefaults;
  const result = validateMappingProfile(invalid);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /taxLineDefaults/);
});
