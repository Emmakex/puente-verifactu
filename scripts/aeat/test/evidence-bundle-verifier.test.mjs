import test from 'node:test';
import assert from 'node:assert/strict';
import { AEAT_ARTIFACTS } from '../../../packages/aeat-adapter/src/constants.mjs';
import {
  parseEvidenceVerifierOptions,
  verifyAeatEvidenceBundle,
} from '../evidence-bundle-verifier-lib.mjs';

const commit = '0123456789abcdef0123456789abcdef01234567';
const artifacts = {
  verifiedAt: AEAT_ARTIFACTS.verifiedAt,
  webServiceDocumentVersion: AEAT_ARTIFACTS.webServiceDocumentVersion,
  validationsDocumentVersion: AEAT_ARTIFACTS.validationsDocumentVersion,
  schemaGeneration: AEAT_ARTIFACTS.schemaGeneration,
  recordVersion: AEAT_ARTIFACTS.recordVersion,
};

function evidence(status, overrides = {}) {
  const accepted = status === 'accepted';
  return {
    schemaVersion: 1,
    gate: 'aeat-test-live',
    recordedAt: '2026-09-15T18:00:00.000Z',
    action: 'submit',
    expectedStatus: status,
    sourceCommit: commit,
    summary: {
      mode: 'test',
      xmlSha256: (accepted ? 'a' : 'b').repeat(64),
      recordHash: (accepted ? 'c' : 'd').repeat(64),
      aeatArtifacts: { ...artifacts },
    },
    result: accepted ? {
      status: 'accepted',
      csvPresent: true,
      csvSha256: 'e'.repeat(64),
      waitSeconds: 60,
      records: [{ status: 'accepted', errorCode: null }],
    } : {
      status: 'rejected',
      csvPresent: false,
      csvSha256: null,
      waitSeconds: 60,
      records: [{ status: 'rejected', errorCode: '1100', errorDescriptionSha256: 'f'.repeat(64) }],
    },
    ...overrides,
  };
}

test('valid accepted/rejected transmission bundle verifies but remains partial', () => {
  const result = verifyAeatEvidenceBundle({
    accepted: evidence('accepted'),
    rejected: evidence('rejected'),
    sourceCommit: commit,
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.releaseUnblocked, false);
  assert.deepEqual(result.remainingExternalEvidence, ['reconciliation']);
  assert.equal(result.verified.acceptedSubmission, true);
  assert.equal(result.verified.rejectedSubmission, true);
  assert.deepEqual(result.observedWaitSeconds, [60]);
});

test('bundle rejects evidence from a different source commit', () => {
  assert.throws(() => verifyAeatEvidenceBundle({
    accepted: evidence('accepted'),
    rejected: evidence('rejected'),
    sourceCommit: 'f'.repeat(40),
  }), { code: 'VF_AEAT_EVIDENCE_SOURCE_COMMIT_MISMATCH' });
});

test('bundle rejects stale or mismatched AEAT artifact versions', () => {
  const rejected = evidence('rejected');
  rejected.summary.aeatArtifacts.validationsDocumentVersion = '0.0.0';
  assert.throws(() => verifyAeatEvidenceBundle({
    accepted: evidence('accepted'),
    rejected,
    sourceCommit: commit,
  }), { code: 'VF_AEAT_EVIDENCE_ARTIFACT_VERSION_MISMATCH' });
});

test('dry-run documents cannot satisfy the live evidence bundle', () => {
  const accepted = evidence('accepted', { action: 'dry-run' });
  assert.throws(() => verifyAeatEvidenceBundle({
    accepted,
    rejected: evidence('rejected'),
    sourceCommit: commit,
  }), { code: 'VF_AEAT_EVIDENCE_NOT_SUBMISSION' });
});

test('accepted evidence must contain accepted status and CSV fingerprint', () => {
  const accepted = evidence('accepted');
  accepted.result.csvPresent = false;
  accepted.result.csvSha256 = null;
  assert.throws(() => verifyAeatEvidenceBundle({
    accepted,
    rejected: evidence('rejected'),
    sourceCommit: commit,
  }), { code: 'VF_AEAT_EVIDENCE_ACCEPTED_CSV_MISSING' });
});

test('rejected evidence must retain a normalized diagnostic code', () => {
  const rejected = evidence('rejected');
  rejected.result.records = [{ status: 'rejected', errorCode: null }];
  assert.throws(() => verifyAeatEvidenceBundle({
    accepted: evidence('accepted'),
    rejected,
    sourceCommit: commit,
  }), { code: 'VF_AEAT_EVIDENCE_REJECTED_DIAGNOSTIC_MISSING' });
});

test('bundle requires observed TiempoEsperaEnvio', () => {
  const accepted = evidence('accepted');
  const rejected = evidence('rejected');
  accepted.result.waitSeconds = null;
  rejected.result.waitSeconds = null;
  assert.throws(() => verifyAeatEvidenceBundle({ accepted, rejected, sourceCommit: commit }), {
    code: 'VF_AEAT_EVIDENCE_WAIT_SECONDS_MISSING',
  });
});

test('raw sensitive fields are rejected by exact key without rejecting fingerprints', () => {
  const accepted = evidence('accepted');
  accepted.result.csv = 'RAW-CSV-MUST-NOT-BE-HERE';
  assert.throws(() => verifyAeatEvidenceBundle({
    accepted,
    rejected: evidence('rejected'),
    sourceCommit: commit,
  }), { code: 'VF_AEAT_EVIDENCE_RAW_SENSITIVE_FIELD' });

  const clean = verifyAeatEvidenceBundle({
    accepted: evidence('accepted'),
    rejected: evidence('rejected'),
    sourceCommit: commit,
  });
  assert.match(clean.evidenceFingerprints.acceptedCsvSha256, /^[0-9a-f]{64}$/);
});

test('invalid evidence hashes fail closed', () => {
  const accepted = evidence('accepted');
  accepted.summary.xmlSha256 = 'not-a-hash';
  assert.throws(() => verifyAeatEvidenceBundle({
    accepted,
    rejected: evidence('rejected'),
    sourceCommit: commit,
  }), { code: 'VF_AEAT_EVIDENCE_HASH_INVALID' });
});

test('verifier output contains no raw evidence bodies or sensitive sample values', () => {
  const accepted = evidence('accepted');
  accepted.summary.installationNumber = 'PRIVATE-INSTALLATION';
  accepted.summary.fiscalNumber = 'PRIVATE-FISCAL-NUMBER';
  const result = verifyAeatEvidenceBundle({
    accepted,
    rejected: evidence('rejected'),
    sourceCommit: commit,
  });
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /PRIVATE-INSTALLATION|PRIVATE-FISCAL-NUMBER/);
});

test('CLI options require both evidence files and exact source commit', () => {
  assert.throws(() => parseEvidenceVerifierOptions([]), { code: 'VF_AEAT_EVIDENCE_OPTIONS_REQUIRED' });
  assert.deepEqual(parseEvidenceVerifierOptions([
    '--accepted', 'accepted.json',
    '--rejected', 'rejected.json',
    '--source-commit', commit,
  ]), {
    acceptedPath: 'accepted.json',
    rejectedPath: 'rejected.json',
    sourceCommit: commit,
  });
});
