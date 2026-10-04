import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateManualVat,
  isRectifyingInvoiceType,
  manualPayload,
} from '../src/manual-model.mjs';

test('manual VAT calculator uses exact cents and supports negative rectifications', () => {
  assert.deepEqual(calculateManualVat('100.00', '21'), {
    taxAmount: '21.00',
    totalAmount: '121.00',
  });
  assert.deepEqual(calculateManualVat('-100.00', '21'), {
    taxAmount: '-21.00',
    totalAmount: '-121.00',
  });
  assert.deepEqual(calculateManualVat('10.05', '10'), {
    taxAmount: '1.01',
    totalAmount: '11.06',
  });
});

test('manual browser payload stays neutral and omits empty F2 customer', () => {
  const result = manualPayload({
    series: 'A-',
    number: '1',
    issueDate: '2026-10-04',
    invoiceType: 'F2',
    description: 'Servicio',
    issuerName: 'Empresa Demo',
    issuerTaxId: '89890001K',
    recipientName: '',
    recipientTaxId: '',
    baseAmount: '100.00',
    rate: '21',
    taxAmount: '21.00',
    totalAmount: '121.00',
  });
  assert.equal('recipient' in result, false);
  assert.equal('organizationId' in result, false);
  assert.equal('installationId' in result, false);
  assert.equal('taxBreakdown' in result, false);
  assert.deepEqual(result.tax, {
    rate: '21',
    baseAmount: '100.00',
    taxAmount: '21.00',
    totalAmount: '121.00',
  });
});

test('manual browser payload includes explicit rectification mode only for R types', () => {
  assert.equal(isRectifyingInvoiceType('F1'), false);
  assert.equal(isRectifyingInvoiceType('R4'), true);
  const result = manualPayload({
    series: 'R-',
    number: '1',
    issueDate: '2026-10-04',
    invoiceType: 'R4',
    description: 'Rectificación',
    issuerName: 'Empresa Demo',
    issuerTaxId: '89890001K',
    recipientName: 'Cliente Demo',
    recipientTaxId: 'B12345678',
    baseAmount: '-100.00',
    rate: '21',
    taxAmount: '-21.00',
    totalAmount: '-121.00',
    rectificationType: 'S',
    correctedBaseAmount: '100.00',
    correctedTaxAmount: '21.00',
  });
  assert.deepEqual(result.rectification, {
    type: 'S',
    correctedBaseAmount: '100.00',
    correctedTaxAmount: '21.00',
  });
});
