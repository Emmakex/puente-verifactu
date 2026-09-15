import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDelimiter, parseCsv } from '../src/csv.mjs';

test('detects semicolon for Spanish decimal CSV', () => {
  const csv = 'Factura;Base;Total\n1;100,00;121,00\n';
  assert.equal(detectDelimiter(csv), ';');
  assert.equal(parseCsv(csv).rows[0].Base, '100,00');
});

test('parses quoted separators and escaped quotes', () => {
  const csv = 'Factura,Descripcion,Total\n1,"Servicio, especial ""premium""",121.00\n';
  const parsed = parseCsv(csv);
  assert.equal(parsed.rows[0].Descripcion, 'Servicio, especial "premium"');
});
