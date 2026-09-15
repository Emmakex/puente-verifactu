import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configurationDefaults,
  initialSelections,
  missingRequiredConfiguration,
  preflightPayload,
  targetLabel,
} from '../src/model.mjs';

const inspection = {
  headers: ['Nº Factura', 'Fecha doc', 'Observaciones'],
  assistant: {
    suggestions: [
      { source: 'Nº Factura', target: 'number', status: 'auto', confidence: 1 },
      { source: 'Fecha doc', target: 'issueDate', status: 'review', confidence: 0.81 },
    ],
    profile: { fields: { 'Nº Factura': 'number' } },
  },
};

test('wizard starts automatic mappings confirmed and review mappings pending', () => {
  const selections = initialSelections(inspection);
  assert.deepEqual(selections[0], {
    source: 'Nº Factura', target: 'number', status: 'auto', confidence: 1, confirmed: true,
  });
  assert.equal(selections[1].target, 'issueDate');
  assert.equal(selections[1].confirmed, false);
  assert.equal(selections[2].status, 'unmatched');
});

test('preflight payload excludes unconfirmed review mappings', () => {
  const selections = initialSelections(inspection);
  let payload = preflightPayload(selections, { currency: 'EUR' });
  assert.equal(payload.overrides['Nº Factura'], 'number');
  assert.equal(payload.overrides['Fecha doc'], undefined);
  selections[1].confirmed = true;
  payload = preflightPayload(selections, { currency: 'EUR' });
  assert.equal(payload.overrides['Fecha doc'], 'issueDate');
});

test('required company configuration is explicit and localized labels exist', () => {
  const defaults = configurationDefaults();
  assert.equal(defaults.currency, 'EUR');
  const missing = missingRequiredConfiguration(defaults);
  assert.equal(missing.includes('issuer.name'), true);
  assert.equal(missing.includes('issuer.taxId'), true);
  assert.equal(targetLabel('totals.totalAmount', 'es'), 'Total factura');
  assert.equal(targetLabel('totals.totalAmount', 'en'), 'Invoice total');
});
