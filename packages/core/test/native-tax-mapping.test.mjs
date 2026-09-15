import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMapping, validateMappingProfile } from '../src/mapping.mjs';

const profile = {
  profileVersion: 1,
  id: 'woo-v1',
  name: 'WooCommerce v1',
  sourceType: 'native',
  fields: {
    order_number: 'number',
    order_date: 'issueDate',
    description: 'description',
    customer_name: 'recipients.0.name',
    customer_tax_id: 'recipients.0.taxId',
    total_amount: 'totals.totalAmount',
    source_invoice_id: 'sourceInvoiceId',
    tax_lines: 'taxBreakdown',
  },
  transforms: {},
  taxLineDefaults: { taxCode: '01', regimeKey: '01', operationClass: 'S1' },
  constants: {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: 'server-owned',
    installationId: 'server-owned',
    sourceSystem: 'woocommerce',
    invoiceType: 'F1',
    issuer: { name: 'Demo issuer', taxId: 'TESTISSUER' },
    currency: 'EUR',
  },
  defaults: {},
};

test('native tax lines preserve multiple rates while fiscal classification stays server-side', () => {
  const source = {
    source_invoice_id: 'woo:1:order:10',
    order_number: '10',
    order_date: '2026-09-15',
    description: 'WooCommerce order 10',
    customer_name: 'Demo customer',
    customer_tax_id: 'TESTCUSTOMER',
    total_amount: '154.00',
    tax_lines: [
      { rate: '21', baseAmount: '100.00', taxAmount: '21.00' },
      { rate: '10', baseAmount: '30.00', taxAmount: '3.00' },
    ],
  };
  const mapped = applyMapping(source, profile);
  assert.equal(mapped.taxBreakdown.length, 2);
  assert.deepEqual(mapped.taxBreakdown[0], {
    taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '21', baseAmount: '100.00', taxAmount: '21.00',
  });
  assert.equal(mapped.totals.baseAmount, '130.00');
  assert.equal(mapped.totals.taxAmount, '24.00');
});

test('native source cannot inject fiscal classification into tax lines', () => {
  assert.throws(() => applyMapping({
    order_number: '10',
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
