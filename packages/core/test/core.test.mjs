import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryIntentStore,
  applyMapping,
  canTransition,
  fingerprintIntent,
  inferMapping,
  makeIdempotencyKey,
  preflightRows,
  validateInvoiceIntent,
} from '../src/index.mjs';

const profile = {
  profileVersion: 1,
  id: 'test',
  name: 'Test',
  sourceType: 'csv',
  fields: {
    Factura: 'number',
    Fecha: 'issueDate',
    Tipo: 'invoiceType',
    Cliente: 'recipients.0.name',
    NIF: 'recipients.0.taxId',
    Base: 'taxBreakdown.0.baseAmount',
    IVA: 'taxBreakdown.0.taxAmount',
    Total: 'totals.totalAmount',
  },
  transforms: {
    Fecha: ['trim', 'date_dmy'],
    Tipo: ['trim', 'upper'],
    Base: ['trim', 'decimal_comma'],
    IVA: ['trim', 'decimal_comma'],
    Total: ['trim', 'decimal_comma'],
  },
  constants: {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: 'org_test',
    installationId: 'install_test',
    sourceSystem: 'csv-test',
    description: 'Servicio',
    issuer: { name: 'Emisor SL', taxId: 'B00000000' },
    currency: 'EUR',
    taxBreakdown: [{ taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '21' }],
  },
  defaults: {},
};

function mappedIntent() {
  return applyMapping({ Factura: 'A-1', Fecha: '15/09/2026', Tipo: 'f1', Cliente: 'Cliente SL', NIF: 'B12345678', Base: '100,00', IVA: '21,00', Total: '121,00' }, profile);
}

test('mapping transforms values, derives identity and safe totals', () => {
  const intent = mappedIntent();
  assert.equal(intent.issueDate, '2026-09-15');
  assert.equal(intent.invoiceType, 'F1');
  assert.equal(intent.taxBreakdown[0].baseAmount, '100.00');
  assert.equal(intent.totals.baseAmount, '100.00');
  assert.equal(intent.totals.taxAmount, '21.00');
  assert.equal(intent.sourceInvoiceId, 'A-1');
});

test('invoice validation accepts a consistent F1 intent', () => {
  assert.deepEqual(validateInvoiceIntent(mappedIntent()).errors, []);
});

test('F2 can omit recipient while F1 cannot', () => {
  const intent = mappedIntent();
  delete intent.recipients;
  intent.invoiceType = 'F2';
  assert.equal(validateInvoiceIntent(intent).ok, true);
  intent.invoiceType = 'F1';
  assert.equal(validateInvoiceIntent(intent).ok, false);
});

test('rectifying invoice requires rectification type', () => {
  const intent = mappedIntent();
  intent.invoiceType = 'R4';
  assert.equal(validateInvoiceIntent(intent).errors.some((error) => error.code === 'VF_VALIDATION_RECTIFICATION_TYPE'), true);
  intent.rectification = { type: 'I' };
  assert.equal(validateInvoiceIntent(intent).ok, true);
});

test('idempotency is stable across key ordering and ignores source metadata', () => {
  const intent = mappedIntent();
  const reordered = { ...intent, issuer: { taxId: intent.issuer.taxId, name: intent.issuer.name }, sourceMetadata: { importedAt: 'later' } };
  assert.equal(makeIdempotencyKey(intent), makeIdempotencyKey(reordered));
  assert.equal(fingerprintIntent(intent), fingerprintIntent(reordered));
});

test('append-only memory store returns duplicate and conflict safely', () => {
  const store = new InMemoryIntentStore();
  const intent = mappedIntent();
  const first = store.put(intent);
  const duplicate = store.put(structuredClone(intent));
  const changed = structuredClone(intent);
  changed.description = 'Otro servicio';
  const conflict = store.put(changed);
  assert.equal(first.status, 'created');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(conflict.status, 'conflict');
  assert.equal(store.events().length, 1);
});

test('preflight is dry-run and reports valid and invalid rows', () => {
  const report = preflightRows([
    { Factura: 'A-1', Fecha: '15/09/2026', Tipo: 'F1', Cliente: 'Cliente SL', NIF: 'B12345678', Base: '100,00', IVA: '21,00', Total: '121,00' },
    { Factura: 'A-2', Fecha: '99/99/2026', Tipo: 'F1', Cliente: '', NIF: '', Base: '100,00', IVA: '21,00', Total: '121,00' },
  ], profile);
  assert.equal(report.mode, 'dry-run');
  assert.deepEqual(report.summary, { rows: 2, valid: 1, invalid: 1 });
});

test('header inference recognizes common Spanish columns', () => {
  const inferred = inferMapping(['Nº Factura', 'Fecha factura', 'NIF Cliente', 'Base imponible', 'Total']);
  assert.equal(inferred.profile.fields['Nº Factura'], 'number');
  assert.equal(inferred.profile.fields['Fecha factura'], 'issueDate');
  assert.equal(inferred.profile.fields['NIF Cliente'], 'recipients.0.taxId');
});

test('state machine blocks destructive shortcuts', () => {
  assert.equal(canTransition('received', 'validated'), true);
  assert.equal(canTransition('validated', 'accepted'), false);
  assert.equal(canTransition('accepted', 'received'), false);
});
