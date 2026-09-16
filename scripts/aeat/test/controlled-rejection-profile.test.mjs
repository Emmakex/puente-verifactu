import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveGateFixture,
  buildLiveGateSummary,
  parseLiveGateOptions,
} from '../live-gate-lib.mjs';
import { serializeAeatSoapRequest } from '../../../packages/aeat-adapter/src/serialize.mjs';

const baseEnv = {
  AEAT_TEST_ISSUER_NAME: 'Empresa Demo SL',
  AEAT_TEST_ISSUER_NIF: 'B12345678',
  AEAT_TEST_PRODUCER_NIF: 'B87654321',
  AEAT_TEST_PRODUCER_NAME: 'Kairoseth Extensions',
  AEAT_TEST_TIMEZONE: 'Europe/Madrid',
};

const guardedEnv = {
  ...baseEnv,
  AEAT_LIVE_SEND: 'YES',
  AEAT_CONTROLLED_REJECTION: 'YES',
};

test('controlled rejection profile requires a real send', () => {
  assert.throws(
    () => parseLiveGateOptions([
      '--rejection-profile', 'future-issue-date',
      '--expect', 'rejected',
    ], { ...baseEnv, AEAT_CONTROLLED_REJECTION: 'YES' }),
    { code: 'VF_AEAT_GATE_REJECTION_SEND_REQUIRED' },
  );
});

test('controlled rejection profile requires rejected expectation and explicit guard', () => {
  assert.throws(
    () => parseLiveGateOptions([
      '--send',
      '--rejection-profile', 'future-issue-date',
    ], { ...baseEnv, AEAT_LIVE_SEND: 'YES', AEAT_CONTROLLED_REJECTION: 'YES' }),
    { code: 'VF_AEAT_GATE_REJECTION_EXPECT_REJECTED' },
  );
  assert.throws(
    () => parseLiveGateOptions([
      '--send',
      '--expect', 'rejected',
      '--rejection-profile', 'future-issue-date',
    ], { ...baseEnv, AEAT_LIVE_SEND: 'YES' }),
    { code: 'VF_AEAT_GATE_REJECTION_GUARD' },
  );
});

test('future issue date profile cannot be mixed with a manually supplied issue date', () => {
  assert.throws(
    () => parseLiveGateOptions([
      '--send',
      '--expect', 'rejected',
      '--rejection-profile', 'future-issue-date',
    ], { ...guardedEnv, AEAT_TEST_ISSUE_DATE: '2026-12-31' }),
    { code: 'VF_AEAT_GATE_REJECTION_PROFILE_DATE_CONFLICT' },
  );
});

test('future issue date profile generates tomorrow in the configured local calendar', () => {
  const options = parseLiveGateOptions([
    '--send',
    '--expect', 'rejected',
    '--rejection-profile', 'future-issue-date',
  ], guardedEnv);
  assert.equal(options.rejectionProfile, 'future-issue-date');

  const fixture = buildLiveGateFixture(
    baseEnv,
    new Date('2026-09-15T22:30:00.000Z'),
    { rejectionProfile: options.rejectionProfile },
  );
  assert.equal(fixture.record.generatedAt.slice(0, 10), '2026-09-16');
  assert.equal(fixture.intent.issueDate, '2026-09-17');
  assert.equal(fixture.record.invoice.issueDate, '2026-09-17');
  assert.equal(fixture.rejectionProfile, 'future-issue-date');
});

test('controlled rejection evidence summary identifies the profile without exposing raw XML', () => {
  const fixture = buildLiveGateFixture(
    baseEnv,
    new Date('2026-09-15T08:00:00.000Z'),
    { rejectionProfile: 'future-issue-date' },
  );
  const xml = serializeAeatSoapRequest({
    issuer: fixture.issuer,
    entries: [{ intent: fixture.intent, record: fixture.record }],
    sif: fixture.sif,
  });
  const summary = buildLiveGateSummary(fixture, xml);
  assert.equal(summary.controlledRejectionProfile, 'future-issue-date');
  assert.match(summary.xmlSha256, /^[0-9a-f]{64}$/);
  assert.equal(summary.aeatArtifacts.validationsDocumentVersion, '1.2.2');
  assert.doesNotMatch(JSON.stringify(summary), /<soapenv:Envelope/);
});
