import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptMappingSuggestions, suggestMapping } from '../src/mapping-assistant.mjs';

test('assistant auto-maps strong Spanish aliases and reports configuration gaps', () => {
  const rows = [
    {
      'Nº Factura': 'A-1',
      'Fecha de factura': '15/09/2026',
      'Tipo factura': 'F1',
      Concepto: 'Servicio mensual',
      'Base imponible': '100,00',
      'Cuota IVA': '21,00',
      'Total factura': '121,00',
    },
  ];
  const report = suggestMapping(Object.keys(rows[0]), { sampleRows: rows, sourceType: 'xlsx' });
  assert.equal(report.profile.sourceType, 'xlsx');
  assert.equal(report.profile.fields['Nº Factura'], 'number');
  assert.equal(report.profile.fields['Tipo factura'], 'invoiceType');
  assert.equal(report.profile.fields['Total factura'], 'totals.totalAmount');
  assert.equal(report.missingConfiguration.includes('issuer.taxId'), true);
  assert.equal(report.safeToPreflight, false);
});

test('assistant leaves medium-confidence mapping for explicit review', () => {
  const rows = [{ 'Fecha de expedición documento': '2026-09-15' }];
  const report = suggestMapping(Object.keys(rows[0]), { sampleRows: rows });
  const suggestion = report.suggestions.find((item) => item.source === 'Fecha de expedición documento');
  assert.equal(suggestion.target, 'issueDate');
  assert.equal(['auto', 'review'].includes(suggestion.status), true);
  if (suggestion.status === 'review') {
    assert.equal(report.profile.fields['Fecha de expedición documento'], undefined);
    const accepted = acceptMappingSuggestions(report, ['Fecha de expedición documento']);
    assert.equal(accepted.fields['Fecha de expedición documento'], 'issueDate');
  }
});

test('assistant never maps an unrelated column just because values are numeric', () => {
  const rows = [{ Unidades: '12', Almacen: '4' }];
  const report = suggestMapping(Object.keys(rows[0]), { sampleRows: rows });
  assert.equal(report.suggestions.some((item) => item.source === 'Unidades'), false);
  assert.equal(report.suggestions.some((item) => item.source === 'Almacen'), false);
});
