import test from 'node:test';
import assert from 'node:assert/strict';
import { AEAT_ARTIFACTS } from '../../../packages/aeat-adapter/src/constants.mjs';
import {
  parseExternalGateEvidenceOptions,
  verifyAeatExternalGateEvidence,
} from '../external-gate-evidence-lib.mjs';

const commit = '0123456789abcdef0123456789abcdef01234567';
const acceptedHash = 'c'.repeat(64);
const artifacts = {
  verifiedAt: AEAT_ARTIFACTS.verifiedAt,
  webServiceDocumentVersion: AEAT_ARTIFACTS.webServiceDocumentVersion,
  validationsDocumentVersion: AEAT_ARTIFACTS.validationsDocumentVersion,
  schemaGeneration: AEAT_ARTIFACTS.schemaGeneration,
  recordVersion: AEAT_ARTIFACTS.recordVersion,
};

function transmission(status) {
  const accepted = status === 'accepted';
  return {
    schemaVersion: 1,
    gate: 'aeat-test-live',
    recordedAt: '2026-09-16T18:00:00.000Z',
    action: 'submit',
    expectedStatus: status,
    sourceCommit: commit,
    summary: {
      mode: 'test',
      controlledRejectionProfile: accepted ? null : 'future-issue-date',
      xmlSha256: (accepted ? 'a' : 'b').repeat(64),
      recordHash: accepted ? acceptedHash : 'd'.repeat(64),
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
  };
}

function reconciliation(overrides = {}) {
  return {
    schemaVersion: 1,
    gate: 'aeat-official-reconciliation-live',
    recordedAt: '2026-09-16T18:05:00.000Z',
    environment: 'test',
    mode: 'inspect',
    sourceCommit: commit,
    jobIdSha256: '1'.repeat(64),
    entryRecordHashes: [acceptedHash],
    certificate: {
      pfxSha256: '2'.repeat(64),
      passphraseSource: 'file',
    },
    beforeState: 'reconciliation_required',
    afterState: 'reconciliation_required',
    assessment: {
      outcome: 'received',
      allReceived: true,
      shouldReissue: false,
      applied: false,
      entryCount: 1,
      entries: [{
        outcome: 'received',
        received: true,
        storedState: 'accepted',
        reason: null,
        errorCode: null,
      }],
    },
    ...overrides,
  };
}

test('complete accepted/rejected/reconciliation evidence qualifies the external gate evidence only', () => {
  const result = verifyAeatExternalGateEvidence({
    accepted: transmission('accepted'),
    rejected: transmission('rejected'),
    reconciliation: reconciliation(),
    sourceCommit: commit,
  });

  assert.equal(result.status, 'external_gate_evidence_complete');
  assert.equal(result.releaseUnblocked, false);
  assert.equal(result.automaticIssueClosure, false);
  assert.equal(result.verified.acceptedSubmission, true);
  assert.equal(result.verified.deterministicRejectedSubmission, true);
  assert.equal(result.verified.officialReconciliation, true);
  assert.equal(result.verified.acceptedRecordBoundToReconciliation, true);
  assert.match(result.evidenceFingerprints.reconciliationSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.nextManualSteps, [
    'review_external_evidence',
    'close_github_issue_6_if_accepted',
    'update_release_gate_config_in_a_separate_reviewed_change',
    'prepare_final_responsible_declaration_for_the_exact_release_version',
  ]);
});

test('reconciliation must belong to the same candidate commit', () => {
  const rec = reconciliation({ sourceCommit: 'f'.repeat(40) });
  assert.throws(() => verifyAeatExternalGateEvidence({
    accepted: transmission('accepted'),
    rejected: transmission('rejected'),
    reconciliation: rec,
    sourceCommit: commit,
  }), { code: 'VF_AEAT_EXTERNAL_GATE_SOURCE_COMMIT_MISMATCH' });
});

test('reconciliation must be bound to the accepted fiscal record hash', () => {
  const rec = reconciliation({ entryRecordHashes: ['9'.repeat(64)] });
  assert.throws(() => verifyAeatExternalGateEvidence({
    accepted: transmission('accepted'),
    rejected: transmission('rejected'),
    reconciliation: rec,
    sourceCommit: commit,
  }), { code: 'VF_AEAT_EXTERNAL_GATE_ACCEPTED_RECORD_MISMATCH' });
});

test('unresolved or not-found reconciliation cannot complete external evidence', () => {
  const rec = reconciliation({
    assessment: {
      outcome: 'unresolved',
      allReceived: false,
      shouldReissue: false,
      applied: false,
      entryCount: 1,
      entries: [{ outcome: 'not_found', received: false, storedState: null, reason: 'not_found_is_not_proof_of_safe_reissue', errorCode: null }],
    },
  });
  assert.throws(() => verifyAeatExternalGateEvidence({
    accepted: transmission('accepted'),
    rejected: transmission('rejected'),
    reconciliation: rec,
    sourceCommit: commit,
  }), { code: 'VF_AEAT_EXTERNAL_GATE_RECONCILIATION_UNRESOLVED' });
});

test('apply evidence must reflect completed state only after exact reconciliation', () => {
  const validApply = reconciliation({
    mode: 'apply',
    afterState: 'completed',
    assessment: {
      outcome: 'received',
      allReceived: true,
      shouldReissue: false,
      applied: true,
      entryCount: 1,
      entries: [{ outcome: 'received', received: true, storedState: 'accepted', reason: null, errorCode: null }],
    },
  });
  assert.equal(verifyAeatExternalGateEvidence({
    accepted: transmission('accepted'),
    rejected: transmission('rejected'),
    reconciliation: validApply,
    sourceCommit: commit,
  }).reconciliation.mode, 'apply');

  const invalidApply = { ...validApply, afterState: 'reconciliation_required' };
  assert.throws(() => verifyAeatExternalGateEvidence({
    accepted: transmission('accepted'),
    rejected: transmission('rejected'),
    reconciliation: invalidApply,
    sourceCommit: commit,
  }), { code: 'VF_AEAT_EXTERNAL_GATE_APPLY_STATE_INVALID' });
});

test('raw sensitive reconciliation fields fail closed', () => {
  const rec = reconciliation();
  rec.taxId = 'B12345678';
  assert.throws(() => verifyAeatExternalGateEvidence({
    accepted: transmission('accepted'),
    rejected: transmission('rejected'),
    reconciliation: rec,
    sourceCommit: commit,
  }), { code: 'VF_AEAT_EXTERNAL_GATE_RAW_SENSITIVE_FIELD' });
});

test('CLI requires exactly the three evidence files and candidate commit', () => {
  assert.throws(() => parseExternalGateEvidenceOptions([]), { code: 'VF_AEAT_EXTERNAL_GATE_OPTIONS_REQUIRED' });
  assert.deepEqual(parseExternalGateEvidenceOptions([
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
  assert.throws(() => parseExternalGateEvidenceOptions(['--unknown', 'x']), {
    code: 'VF_AEAT_EXTERNAL_GATE_OPTION_UNKNOWN',
  });
});
