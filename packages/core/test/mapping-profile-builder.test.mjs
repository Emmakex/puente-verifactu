import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMappingProfile, suggestMapping } from '../src/mapping-assistant.mjs';
import { applyMapping, setPath, validateMappingProfile } from '../src/mapping.mjs';

function report() {
  return suggestMapping(
    ['Factura cliente', 'Fecha documento', 'Importe final'],
    {
      sampleRows: [{ 'Factura cliente': 'A-1', 'Fecha documento': '15/09/2026', 'Importe final': '121,00' }],
      sourceType: 'xlsx',
    },
  );
}

test('manual override only accepts known source and canonical mapping target', () => {
  const assistant = report();
  const profile = buildMappingProfile(assistant, {
    overrides: {
      'Factura cliente': 'number',
      'Fecha documento': 'issueDate',
      'Importe final': 'totals.totalAmount',
    },
    constants: { 'issuer.name': 'Empresa Demo' },
  });
  assert.equal(profile.fields['Factura cliente'], 'number');
  assert.equal(profile.fields['Fecha documento'], 'issueDate');
  assert.equal(profile.constants.issuer.name, 'Empresa Demo');
});

test('unknown source and arbitrary target are rejected', () => {
  const assistant = report();
  assert.throws(() => buildMappingProfile(assistant, { overrides: { Inventada: 'number' } }), { code: 'VF_MAPPING_SOURCE_UNKNOWN' });
  assert.throws(() => buildMappingProfile(assistant, { overrides: { 'Factura cliente': '__proto__.polluted' } }), { code: 'VF_MAPPING_TARGET_UNKNOWN' });
});

test('two source columns cannot map to the same canonical target', () => {
  const assistant = report();
  assert.throws(() => buildMappingProfile(assistant, {
    overrides: {
      'Factura cliente': 'number',
      'Fecha documento': 'number',
    },
  }), { code: 'VF_MAPPING_TARGET_DUPLICATE' });
});

test('generic path setter rejects prototype-polluting path segments', () => {
  const target = {};
  assert.throws(() => setPath(target, '__proto__.polluted', true), /Unsafe mapping path/);
  assert.throws(() => setPath(target, 'constructor.prototype.polluted', true), /Unsafe mapping path/);
  assert.equal({}.polluted, undefined);
});

test('manually supplied MappingProfile cannot bypass canonical target allowlist', () => {
  const profile = {
    profileVersion: 1,
    id: 'malicious',
    name: 'Malicious',
    sourceType: 'webhook',
    fields: { Invoice: '__proto__.polluted' },
    transforms: {},
    constants: {},
    defaults: {},
  };
  assert.equal(validateMappingProfile(profile).ok, false);
  assert.throws(() => applyMapping({ Invoice: 'A-1' }, profile), /Unsupported mapping target/);
  assert.equal({}.polluted, undefined);
});
