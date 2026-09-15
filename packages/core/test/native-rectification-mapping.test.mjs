import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMapping, validateMappingProfile } from '../src/mapping.mjs';
import { validateInvoiceIntent } from '../src/validation.mjs';

const refundProfile = {
  profileVersion: 1,
  id: 'woo-refund-v1',
  name: 'Woo refund v1',
  sourceType: 'native',
  fields: {
    source_invoice_id: 'sourceInvoiceId',
    refund_invoice_number: 'number',
    refund_date: 'issueDate',
    description: 'description',
    currency: 'currency',
    customer_name: 'recipients.0.name',
    customer_tax_id: 'recipients.0.taxId',
    total_amount: 'totals.totalAmount',
    tax_lines: 'taxBreakdown',
    original_invoice_number: 'rectification.originalInvoices.0.number',
    original_invoice_date: 'rectification.originalInvoices.0.issueDate',
  },
  transforms: { currency: ['trim', 'upper'] },
  taxLineDefaults: { taxCode: '01', regimeKey: '01', operationClass: 'S1' },
  constants: {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: 'server-owned',
    installationId: 'server-owned',
    sourceSystem: 'woocommerce',
    invoiceType: 'R4',
    rectification: { type: 'I' },
    issuer: { name: 'Demo issuer', taxId: 'TESTISSUER' },
  },
  defaults: {},
};

test('native refund maps original invoice reference while corrective classification remains server-side', () => {
  const mapped = applyMapping({
    source_invoice_id: 'woo:1:refund:20',
    refund_invoice_number: 'RECT-20',
    refund_date: '2026-09-15',
    description: 'Refund 20',
    currency: 'EUR',
    customer_name: 'Demo customer',
    customer_tax_id: 'TESTCUSTOMER',
    original_invoice_number: 'INV-10',
    original_invoice_date: '2026-09-10',
    total_amount: '-121.00',
    tax_lines: [{ rate: '21', baseAmount: '-100.00', taxAmount: '-21.00' }],
  }, refundProfile);

  assert.equal(mapped.invoiceType, 'R4');
  assert.equal(mapped.rectification.type, 'I');
  assert.deepEqual(mapped.rectification.originalInvoices, [{ number: 'INV-10', issueDate: '2026-09-10' }]);
  assert.equal(mapped.totals.baseAmount, '-100.00');
  assert.equal(mapped.totals.taxAmount, '-21.00');
  assert.equal(validateInvoiceIntent(mapped).ok, true);
});

test('native connectors cannot map invoiceType from source data', () => {
  const invalid = structuredClone(refundProfile);
  invalid.fields.refund_kind = 'invoiceType';
  const validation = validateMappingProfile(invalid);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(' '), /cannot control fiscal target invoiceType/);
});
