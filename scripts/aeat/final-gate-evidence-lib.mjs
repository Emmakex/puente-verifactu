import { createHash } from 'node:crypto';
import { verifyAeatEvidenceBundle } from './evidence-bundle-verifier-lib.mjs';

const SHA40_RE = /^[0-9a-f]{40}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const FORBIDDEN_RECONCILIATION_KEYS = new Set([
  'pfx',
  'pfxpath',
  'passphrase',
  'privatekey',
  'xml',
  'soap',
  'rawsoap',
  'rawresponse',
  'csv',
  'errordescription',
  'taxid',
  'issuertaxid',
  'fiscalnumber',
  'refexterna',
  'databasepath',
  'jobid',
  'recordhash',
  'recordhashes',
  'entryrecordhash',
  'entryrecordhashes',
]);

function finalGateError(code, message, field = null) {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  return error;
}

function normalizeKey(value) {
  return String(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function assertNoRawSensitiveKeys(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawSensitiveKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RECONCILIATION_KEYS.has(normalizeKey(key))) {
      throw finalGateError(
        'VF_AEAT_FINAL_EVIDENCE_RAW_SENSITIVE_FIELD',
        'Reconciliation evidence contains a raw sensitive field',
        `${path}.${key}`,
      );
    }
    assertNoRawSensitiveKeys(child, `${path}.${key}`);
  }
}

function assertSha256(value, field) {
  if (!SHA256_RE.test(String(value ?? ''))) {
    throw finalGateError('VF_AEAT_FINAL_EVIDENCE_HASH_INVALID', `${field} must contain a SHA-256 hex digest`, field);
  }
}

function fiscalHashFingerprint(value, field) {
  assertSha256(value, field);
  return createHash('sha256').update(String(value).toUpperCase(), 'utf8').digest('hex');
}

function assertTimestamp(value, field) {
  if (!value || Number.isNaN(Date.parse(String(value)))) {
    throw finalGateError('VF_AEAT_FINAL_EVIDENCE_TIMESTAMP_INVALID', `${field} must contain a valid timestamp`, field);
  }
}

function normalizeCommit(value) {
  const commit = String(value ?? '').trim().toLowerCase();
  if (!SHA40_RE.test(commit)) {
    throw finalGateError(
      'VF_AEAT_FINAL_EVIDENCE_SOURCE_COMMIT_REQUIRED',
      'A 40-character candidate source commit is required',
      'sourceCommit',
    );
  }
  return commit;
}

function verifyReconciliationEvidence(reconciliation, sourceCommit, acceptedRecordHash) {
  assertNoRawSensitiveKeys(reconciliation, 'reconciliation');
  if (reconciliation?.schemaVersion !== 1 || reconciliation?.gate !== 'aeat-official-reconciliation-live') {
    throw finalGateError(
      'VF_AEAT_FINAL_EVIDENCE_RECONCILIATION_SCHEMA_INVALID',
      'Reconciliation evidence must be an AEAT official live reconciliation v1 document',
      'reconciliation',
    );
  }
  assertTimestamp(reconciliation.recordedAt, 'reconciliation.recordedAt');
  if (reconciliation.environment !== 'test') {
    throw finalGateError(
      'VF_AEAT_FINAL_EVIDENCE_RECONCILIATION_ENVIRONMENT_INVALID',
      'Reconciliation evidence must target the AEAT test environment',
      'reconciliation.environment',
    );
  }
  if (String(reconciliation.sourceCommit ?? '').toLowerCase() !== sourceCommit) {
    throw finalGateError(
      'VF_AEAT_FINAL_EVIDENCE_SOURCE_COMMIT_MISMATCH',
      'Reconciliation evidence does not belong to the candidate source commit',
      'reconciliation.sourceCommit',
    );
  }
  if (reconciliation.mode !== 'apply') {
    throw finalGateError(
      'VF_AEAT_FINAL_EVIDENCE_RECONCILIATION_APPLY_REQUIRED',
      'Final gate evidence requires reconciliation apply evidence after an exact official query match',
      'reconciliation.mode',
    );
  }
  if (reconciliation.beforeState !== 'reconciliation_required' || reconciliation.afterState !== 'completed') {
    throw finalGateError(
      'VF_AEAT_FINAL_EVIDENCE_RECONCILIATION_STATE_INVALID',
      'Reconciliation evidence must prove reconciliation_required -> completed',
      'reconciliation.afterState',
    );
  }
  if (reconciliation?.assessment?.allReceived !== true
      || reconciliation?.assessment?.applied !== true
      || reconciliation?.assessment?.shouldReissue !== false) {
    throw finalGateError(
      'VF_AEAT_FINAL_EVIDENCE_RECONCILIATION_ASSESSMENT_INVALID',
      'Reconciliation evidence must prove all records received, applied completion and no reissue',
      'reconciliation.assessment',
    );
  }

  const entries = Array.isArray(reconciliation?.assessment?.entries) ? reconciliation.assessment.entries : [];
  if (reconciliation?.assessment?.entryCount !== 1
      || entries.length !== 1
      || entries[0]?.received !== true
      || entries[0]?.outcome !== 'received'
      || entries[0]?.storedState !== 'accepted') {
    throw finalGateError(
      'VF_AEAT_FINAL_EVIDENCE_RECONCILIATION_ENTRIES_INVALID',
      'Final live-gate evidence v1 requires exactly one received record stored as accepted',
      'reconciliation.assessment.entries',
    );
  }

  assertSha256(reconciliation.jobIdSha256, 'reconciliation.jobIdSha256');
  assertSha256(reconciliation?.certificate?.pfxSha256, 'reconciliation.certificate.pfxSha256');
  const recordHashFingerprints = reconciliation.entryRecordHashFingerprints;
  if (!Array.isArray(recordHashFingerprints) || recordHashFingerprints.length !== 1) {
    throw finalGateError(
      'VF_AEAT_FINAL_EVIDENCE_RECONCILIATION_HASHES_INVALID',
      'Reconciliation evidence must retain exactly one derived fiscal record hash fingerprint',
      'reconciliation.entryRecordHashFingerprints',
    );
  }
  assertSha256(recordHashFingerprints[0], 'reconciliation.entryRecordHashFingerprints.0');
  const acceptedRecordHashFingerprint = fiscalHashFingerprint(acceptedRecordHash, 'accepted.summary.recordHash');
  if (String(recordHashFingerprints[0]).toLowerCase() !== acceptedRecordHashFingerprint) {
    throw finalGateError(
      'VF_AEAT_FINAL_EVIDENCE_RECORD_HASH_MISMATCH',
      'Reconciliation evidence does not belong to the accepted fiscal record',
      'reconciliation.entryRecordHashFingerprints.0',
    );
  }

  return {
    reconciledRecordHashFingerprint: String(recordHashFingerprints[0]).toLowerCase(),
    jobIdSha256: String(reconciliation.jobIdSha256).toLowerCase(),
  };
}

export function verifyAeatFinalGateEvidence({ accepted, rejected, reconciliation, sourceCommit }) {
  const commit = normalizeCommit(sourceCommit);
  const transmission = verifyAeatEvidenceBundle({ accepted, rejected, sourceCommit: commit });
  const acceptedRecordHash = accepted?.summary?.recordHash;
  assertSha256(acceptedRecordHash, 'accepted.summary.recordHash');
  const reconciliationVerified = verifyReconciliationEvidence(reconciliation, commit, acceptedRecordHash);

  return {
    schemaVersion: 1,
    gate: 'aeat-external-gate-evidence',
    status: 'external_gate_evidence_complete',
    sourceCommit: commit,
    verified: {
      acceptedSubmission: true,
      controlledRejectedSubmission: true,
      controlledRejectionProfile: transmission.verified.controlledRejectionProfile,
      officialReconciliationApplied: true,
      acceptedRecordBoundToReconciliation: true,
      artifactVersions: true,
      waitSecondsObserved: true,
      sanitizedEvidence: true,
      shouldReissue: false,
    },
    aeatArtifacts: transmission.aeatArtifacts,
    observedWaitSeconds: transmission.observedWaitSeconds,
    evidenceFingerprints: {
      acceptedXmlSha256: transmission.evidenceFingerprints.acceptedXmlSha256,
      acceptedCsvSha256: transmission.evidenceFingerprints.acceptedCsvSha256,
      rejectedXmlSha256: transmission.evidenceFingerprints.rejectedXmlSha256,
      reconciledRecordHashFingerprint: reconciliationVerified.reconciledRecordHashFingerprint,
      reconciliationJobSha256: reconciliationVerified.jobIdSha256,
    },
    remainingExternalEvidence: [],
    releaseUnblocked: false,
    automaticIssueClosure: false,
    nextAction: 'review_issue_6_and_release_procedure',
  };
}

export function parseFinalGateEvidenceOptions(argv = []) {
  const allowedFlags = new Set(['--accepted', '--rejected', '--reconciliation', '--source-commit']);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowedFlags.has(flag)) {
      throw finalGateError('VF_AEAT_FINAL_EVIDENCE_OPTION_UNKNOWN', `Unsupported option: ${flag}`, flag ?? null);
    }
    if (!value || value.startsWith('--')) {
      throw finalGateError('VF_AEAT_FINAL_EVIDENCE_OPTION_VALUE_REQUIRED', `${flag} requires a value`, flag);
    }
    values.set(flag, value);
  }

  const acceptedPath = values.get('--accepted');
  const rejectedPath = values.get('--rejected');
  const reconciliationPath = values.get('--reconciliation');
  const sourceCommit = values.get('--source-commit');
  if (!acceptedPath || !rejectedPath || !reconciliationPath || !sourceCommit) {
    throw finalGateError(
      'VF_AEAT_FINAL_EVIDENCE_OPTIONS_REQUIRED',
      '--accepted, --rejected, --reconciliation and --source-commit are required',
    );
  }
  return { acceptedPath, rejectedPath, reconciliationPath, sourceCommit };
}
