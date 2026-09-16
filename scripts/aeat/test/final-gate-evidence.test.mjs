import test from 'node:test';
import assert from 'node:assert/strict';
import { AEAT_ARTIFACTS } from '../../../packages/aeat-adapter/src/constants.mjs';
import {
  parseFinalGateEvidenceOptions,
  verifyAeatFinalGateEvidence,
} from '../final-gate-evidence-lib.mjs';

const commit = '0123456789abcdef0123456789abcdef01234567';
const acceptedRecordHash = 'A'.repeat(64);
const artifacts = {
  verifiedAt: AEAT_ARTIFACTS.verifiedAt,
  webServiceDocumentVersion: AEAT_ARTIFACTS.webServiceDocumentVersion,
  validationsDocumentVersion: AEAT_ARTIFACTS.validationsDocumentVersion,
  schemaGeneration: AEAT_ARTIFACTS.schemaGeneration,
  recordVersion: AEAT_ARTIFACTS.recordVersion,
};

function acceptedEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    gate: 'aeat-test-live',
    recordedAt: '2026-09-16T00:00:00.000Z',
    action: 'submit',
    expectedStatus: 'accepted',
    sourceCommit: commit,
    summary: {
      mode: 'test',
      xmlSha256: '1'.repeat(64),
      recordHash: acceptedRecordHash,
      aeatArtifacts: { ...artifacts },
    },
    result: {
      status: 'accepted',
      csvPresent: true,
      csvSha256: '2'.repeat(64),
      waitSeconds: 60,
      records: [{ status: 'accepted', errorCode: null }],
    },
    ...overrides,
  };
}

function rejectedEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    gate: 'aeat-test-live',
    recordedAt: '2026-09-16T00:01:00.000Z',
    action: 'submit',
    expectedStatus: 'rejected',
    sourceCommit: commit,
    summary: {
      mode: 'test',
      controlledRejectionProfile: 'future-issue-date',
      xmlSha256: '3'.repeat(64),
      recordHash: 'B'.repeat(64),
      aeatArtifacts: { ...artifacts },
    },
    result: {
      status: 'rejected',
      csvPresent: false,
      csvSha256: null,
      waitSeconds: 60,
      errorCode: '1100',
      records: [{ status: 'rejected', errorCode: '1100', errorDescriptionSha256: '4'.repeat(64) }],
    },
    ...overrides,
  };
}

function reconciliationEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    gate: 'aeat-official-reconciliation-live',
    recordedAt: '2026-09-16T00:02:00.000Z',
    environment: 'test',
    mode: 'apply',
    sourceCommit: commit,
    jobIdSha256: '5'.repeat(64),
    entryRecordHashes: [acceptedRecordHash.toLowerCase()],
    certificate: {
      pfxSha256: '6'.repeat(64),
      passphraseSource: 'file',
    },
    beforeState: 'reconciliation_required',
    afterState: 'completed',
    assessment: {
      outcome: 'received',
      allReceived: true,
      shouldReissue: false,
      applied: true,
      entryCount: 1,
      entries: [{
        outcome: 'received',
        received: true,
        storedState: 'Correcto',
        reason: null,
        errorCode: null,
      }],
    },
    ...overrides,
  };
}

test('complete accepted rejected and applied reconciliation evidence verifies without unblocking release', () => {
  const result = verifyAeatFinalGateEvidence({
    accepted: acceptedEvidence(),
    rejected: rejectedEvidence(),
    reconciliation: reconciliationEvidence(),
    sourceCommit: commit,
  });

  assert.equal(result.status, 'external_gate_evidence_complete');
  assert.equal(result.sourceCommit, commit);
  assert.equal(result.verified.acceptedSubmission, true);
  assert.equal(result.verified.controlledRejectedSubmission, true);
  assert.equal(result.verified.officialReconciliationApplied, true);
  assert.equal(result.verified.acceptedRecordBoundToReconciliation, true);
  assert.equal(result.verified.shouldReissue, false);
  assert.equal(result.evidenceFingerprints.reconciledRecordHash, acceptedRecordHash.toLowerCase());
  assert.deepEqual(result.remainingExternalEvidence, []);
  assert.equal(result.releaseUnblocked, false);
  assert.equal(result.automaticIssueClosure, false);
});

test('final evidence rejects a different reconciliation source commit', () => {
  assert.throws(() => verifyAeatFinalGateEvidence({
    accepted: acceptedEvidence(),
    rejected: rejectedEvidence(),
    reconciliation: reconciliationEvidence({ sourceCommit: 'f'.repeat(40) }),
    sourceCommit: commit,
  }), { code: 'VF_AEAT_FINAL_EVIDENCE_SOURCE_COMMIT_MISMATCH' });
});

test('final evidence cryptographically binds reconciliation to the accepted fiscal record', () => {
  assert.throws(() => verifyAeatFinalGateEvidence({
    accepted: acceptedEvidence(),
    rejected: rejectedEvidence(),
    reconciliation: reconciliationEvidence({ entryRecordHashes: ['c'.repeat(64)] }),
    sourceCommit: commit,
  }), { code: 'VF_AEAT_FINAL_EVIDENCE_RECORD_HASH_MISMATCH' });
});

test('inspect-only reconciliation cannot satisfy the final external gate evidence', () => {
  assert.throws(() => verifyAeatFinalGateEvidence({
    accepted: acceptedEvidence(),
    rejected: rejectedEvidence(),
    reconciliation: reconciliationEvidence({
      mode: 'inspect',
      afterState: 'reconciliation_required',
      assessment: {
        outcome: 'received',
        allReceived: true,
        shouldReissue: false,
        applied: false,
        entryCount: 1,
        entries: [{ outcome: 'received', received: true }],
      },
    }),
    sourceCommit: commit,
  }), { code: 'VF_AEAT_FINAL_EVIDENCE_RECONCILIATION_APPLY_REQUIRED' });
});

test('unresolved reconciliation cannot satisfy the final external gate evidence', () => {
  const reconciliation = reconciliationEvidence();
  reconciliation.afterState = 'reconciliation_required';
  reconciliation.assessment.allReceived = false;
  reconciliation.assessment.applied = false;
  reconciliation.assessment.entries[0].received = false;
  assert.throws(() => verifyAeatFinalGateEvidence({
    accepted: acceptedEvidence(),
    rejected: rejectedEvidence(),
    reconciliation,
    sourceCommit: commit,
  }), { code: 'VF_AEAT_FINAL_EVIDENCE_RECONCILIATION_STATE_INVALID' });
});

test('raw sensitive reconciliation fields fail closed', () => {
  const reconciliation = reconciliationEvidence();
  reconciliation.databasePath = '/private/runtime.sqlite';
  assert.throws(() => verifyAeatFinalGateEvidence({
    accepted: acceptedEvidence(),
    rejected: rejectedEvidence(),
    reconciliation,
    sourceCommit: commit,
  }), { code: 'VF_AEAT_FINAL_EVIDENCE_RAW_SENSITIVE_FIELD' });
});

test('final verifier reuses deterministic rejection profile requirements', () => {
  const rejected = rejectedEvidence();
  delete rejected.summary.controlledRejectionProfile;
  assert.throws(() => verifyAeatFinalGateEvidence({
    accepted: acceptedEvidence(),
    rejected,
    reconciliation: reconciliationEvidence(),
    sourceCommit: commit,
  }), { code: 'VF_AEAT_EVIDENCE_REJECTION_PROFILE_INVALID' });
});

test('CLI options require accepted rejected reconciliation and exact source commit', () => {
  assert.throws(() => parseFinalGateEvidenceOptions([]), { code: 'VF_AEAT_FINAL_EVIDENCE_OPTIONS_REQUIRED' });
  assert.throws(
    () => parseFinalGateEvidenceOptions(['--accepted', 'a.json', '--unknown', 'x']),
    { code: 'VF_AEAT_FINAL_EVIDENCE_OPTION_UNKNOWN' },
  );
  assert.deepEqual(parseFinalGateEvidenceOptions([
    '--accepted', 'accepted.json',
    '--rejected', 'rejected.json',
    '--reconciliation', 'reconciliation.json',
    '--source-commit', commit,
  ]), {
    acceptedPath: 'accepted.json',
    rejectedPath: 'rejected.json',
    reconciliationPath: 'reconciliation.json',
    sourceCommit: commit,
  });
});
