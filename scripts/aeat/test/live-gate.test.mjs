import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeAeatSoapRequest } from '../../../packages/aeat-adapter/src/serialize.mjs';
import { assertLiveSendAllowed, buildLiveGateFixture, buildLiveGateSummary, maskTaxId } from '../live-gate-lib.mjs';

const env = {
  AEAT_TEST_ISSUER_NAME: 'Empresa Demo SL',
  AEAT_TEST_ISSUER_NIF: 'B12345678',
  AEAT_TEST_PRODUCER_NIF: 'B87654321',
  AEAT_TEST_PRODUCER_NAME: 'Kairoseth Extensions',
  AEAT_TEST_TIMEZONE: 'Europe/Madrid',
};

test('live gate builds deterministic first-record fixture without a certificate', () => {
  const now = new Date('2026-09-15T08:00:00.000Z');
  const fixture = buildLiveGateFixture(env, now);
  assert.equal(fixture.intent.invoiceType, 'F2');
  assert.equal(fixture.record.firstRecord, true);
  assert.equal(fixture.record.totalAmount, '1.21');
  assert.equal(fixture.sif.installationNumber, 'GATE-20260915080000');
  assert.match(fixture.record.generatedAt, /^2026-09-15T10:00:00\+02:00$/);
});

test('live sending requires the double guard', () => {
  assert.equal(assertLiveSendAllowed([], {}), false);
  assert.throws(() => assertLiveSendAllowed(['--send'], {}), { code: 'VF_AEAT_GATE_SEND_GUARD' });
  assert.equal(assertLiveSendAllowed(['--send'], { AEAT_LIVE_SEND: 'YES' }), true);
});

test('summary masks taxpayer ID and fingerprints XML', () => {
  const fixture = buildLiveGateFixture(env, new Date('2026-09-15T08:00:00.000Z'));
  const xml = serializeAeatSoapRequest({ issuer: fixture.issuer, entries: [{ intent: fixture.intent, record: fixture.record }], sif: fixture.sif });
  const summary = buildLiveGateSummary(fixture, xml);
  assert.equal(summary.issuer, 'B1*****78');
  assert.equal(summary.xmlSha256.length, 64);
  assert.ok(summary.xmlBytes > 0);
  assert.doesNotMatch(JSON.stringify(summary), /B12345678/);
});

test('maskTaxId handles short values defensively', () => {
  assert.equal(maskTaxId('AB'), '**');
});
