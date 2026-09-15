import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeAeatSoapRequest } from '../../../packages/aeat-adapter/src/serialize.mjs';
import {
  assertLiveSendAllowed,
  buildLiveGateEvidence,
  buildLiveGateFixture,
  buildLiveGateSummary,
  maskTaxId,
  parseLiveGateOptions,
  sanitizeLiveGateResult,
} from '../live-gate-lib.mjs';

const env = {
  AEAT_TEST_ISSUER_NAME: 'Empresa Demo SL',
  AEAT_TEST_ISSUER_NIF: 'B12345678',
  AEAT_TEST_PRODUCER_NIF: 'B87654321',
  AEAT_TEST_PRODUCER_NAME: 'Kairoseth Extensions',
  AEAT_TEST_TIMEZONE: 'Europe/Madrid',
};

const sourceCommit = '0123456789abcdef0123456789abcdef01234567';

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

test('show-xml is forbidden during a real send', () => {
  assert.throws(
    () => parseLiveGateOptions(['--send', '--show-xml'], { AEAT_LIVE_SEND: 'YES' }),
    { code: 'VF_AEAT_GATE_XML_WITH_SEND_FORBIDDEN' },
  );
});

test('expected status is explicit and validated', () => {
  assert.equal(parseLiveGateOptions(['--send'], { AEAT_LIVE_SEND: 'YES' }).expectedStatus, 'accepted');
  assert.equal(parseLiveGateOptions(['--send', '--expect', 'rejected'], { AEAT_LIVE_SEND: 'YES' }).expectedStatus, 'rejected');
  assert.throws(
    () => parseLiveGateOptions(['--expect', 'maybe'], {}),
    { code: 'VF_AEAT_GATE_EXPECT_STATUS_INVALID' },
  );
});

test('evidence output requires an exact source commit', () => {
  assert.throws(
    () => parseLiveGateOptions(['--evidence-output', 'evidence.json'], {}),
    { code: 'VF_AEAT_GATE_SOURCE_COMMIT_REQUIRED' },
  );
  const options = parseLiveGateOptions([
    '--evidence-output', 'evidence.json',
    '--source-commit', sourceCommit,
  ], {});
  assert.equal(options.sourceCommit, sourceCommit);
});

test('controlled reconciliation seed requires send, accepted expectation, guard, commit and both private paths', () => {
  const base = [
    '--reconciliation-seed-db', 'private/seed.sqlite',
    '--reconciliation-seed-output', 'private/seed.json',
    '--source-commit', sourceCommit,
  ];
  assert.throws(
    () => parseLiveGateOptions(base, { AEAT_RECONCILIATION_SEED: 'YES' }),
    { code: 'VF_AEAT_RECONCILIATION_SEED_SEND_REQUIRED' },
  );
  assert.throws(
    () => parseLiveGateOptions(['--send', '--expect', 'rejected', ...base], { AEAT_LIVE_SEND: 'YES', AEAT_RECONCILIATION_SEED: 'YES' }),
    { code: 'VF_AEAT_RECONCILIATION_SEED_EXPECT_ACCEPTED' },
  );
  assert.throws(
    () => parseLiveGateOptions(['--send', ...base], { AEAT_LIVE_SEND: 'YES' }),
    { code: 'VF_AEAT_RECONCILIATION_SEED_GUARD' },
  );
  assert.throws(
    () => parseLiveGateOptions([
      '--send',
      '--reconciliation-seed-db', 'private/seed.sqlite',
      '--source-commit', sourceCommit,
    ], { AEAT_LIVE_SEND: 'YES', AEAT_RECONCILIATION_SEED: 'YES' }),
    { code: 'VF_AEAT_RECONCILIATION_SEED_PATHS_REQUIRED' },
  );
  assert.throws(
    () => parseLiveGateOptions([
      '--send',
      '--reconciliation-seed-db', 'private/seed.sqlite',
      '--reconciliation-seed-output', 'private/seed.json',
    ], { AEAT_LIVE_SEND: 'YES', AEAT_RECONCILIATION_SEED: 'YES' }),
    { code: 'VF_AEAT_RECONCILIATION_SEED_SOURCE_COMMIT_REQUIRED' },
  );

  const options = parseLiveGateOptions(['--send', ...base], {
    AEAT_LIVE_SEND: 'YES',
    AEAT_RECONCILIATION_SEED: 'YES',
  });
  assert.equal(options.expectedStatus, 'accepted');
  assert.equal(options.reconciliationSeedDb, 'private/seed.sqlite');
  assert.equal(options.reconciliationSeedOutput, 'private/seed.json');
});

test('summary masks taxpayer ID, fingerprints XML and pins AEAT artifact versions', () => {
  const fixture = buildLiveGateFixture(env, new Date('2026-09-15T08:00:00.000Z'));
  const xml = serializeAeatSoapRequest({ issuer: fixture.issuer, entries: [{ intent: fixture.intent, record: fixture.record }], sif: fixture.sif });
  const summary = buildLiveGateSummary(fixture, xml);
  assert.equal(summary.issuer, 'B1*****78');
  assert.equal(summary.xmlSha256.length, 64);
  assert.ok(summary.xmlBytes > 0);
  assert.equal(summary.aeatArtifacts.webServiceDocumentVersion, '1.0.3');
  assert.equal(summary.aeatArtifacts.validationsDocumentVersion, '1.2.2');
  assert.doesNotMatch(JSON.stringify(summary), /B12345678/);
});

test('sanitized result stores hashes instead of raw CSV and descriptions', () => {
  const raw = {
    kind: 'aeat_response',
    status: 'rejected',
    csv: 'VERY-SENSITIVE-CSV',
    waitSeconds: 60,
    records: [{
      externalReference: 'gate-1',
      status: 'rejected',
      errorCode: '1100',
      errorDescription: 'Sensitive functional description B12345678',
      duplicate: false,
    }],
  };
  const sanitized = sanitizeLiveGateResult(raw);
  const text = JSON.stringify(sanitized);
  assert.equal(sanitized.csvPresent, true);
  assert.match(sanitized.csvSha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(text, /VERY-SENSITIVE-CSV/);
  assert.doesNotMatch(text, /Sensitive functional description/);
  assert.doesNotMatch(text, /B12345678/);
  assert.equal(sanitized.records[0].errorCode, '1100');
});

test('evidence is commit-bound and contains only sanitized result material', () => {
  const result = sanitizeLiveGateResult({ status: 'accepted', csv: 'CSV-123', records: [] });
  const evidence = buildLiveGateEvidence({
    action: 'submit',
    expectedStatus: 'accepted',
    sourceCommit,
    summary: { xmlSha256: 'a'.repeat(64) },
    result,
    recordedAt: new Date('2026-09-15T12:00:00Z'),
  });
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.sourceCommit, sourceCommit);
  assert.equal(evidence.result.csvPresent, true);
  assert.doesNotMatch(JSON.stringify(evidence), /CSV-123/);
});

test('maskTaxId handles short values defensively', () => {
  assert.equal(maskTaxId('AB'), '**');
});
