import { createHash } from 'node:crypto';
import { verifyAeatEvidenceBundle } from './evidence-bundle-verifier-lib.mjs';

const SHA40_RE = /^[0-9a-f]{40}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const FORBIDDEN_RAW_KEYS = new Set([
  'pfx',
  'pfxpath',
  'passphrase',
  'privatekey',
  'certificatepem',
  'xml',
  'soap',
  'rawsoap',
  'rawresponse',
  'csv',
  'nif',
  'taxid',
  'fiscalnumber',
  'refexternal',
]);

function gateError(code, message, field = null) {
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
    if (FORBIDDEN_RAW_KEYS.has(normalizeKey(key))) {
      throw gateError(
        'VF_AEAT_EXTERNAL_GATE_RAW_SENSITIVE_FIELD',
        'Reconciliation evidence contains a raw sensitive field',
        `${path}.${key}`,
      );
    }
    assertNoRawSensitiveKeys(child, `${path}.${key}`);
  }
}

function assertTimestamp(value, field) {
  const text = String(value ?? '');
  if (!text || Number.isNaN(Date.parse(text))) {
    throw gateError('VF_AEAT_EXTERNAL_GATE_TIMESTAMP_INVALID', `${field} must be an ISO-compatible timestamp`, field);
  }
}

function assertSha256(value, field) {
  if (!SHA256_RE.test(String(value ?? ''))) {
    throw gateError('VF_AEAT_EXTERNAL_GATE_HASH_INVALID', `${field} must contain a SHA-256 hex digest`, field);
  }
}

function stableFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function verifyReconciliationEvidence(reconciliation, sourceCommit, acceptedRecordHash) {
  assertNoRawSensitiveKeys(reconciliation);
  if (reconciliation?.schemaVersion !== 1 || reconciliation?.gate !== 'aeat-official-reconciliation-live') {
    throw gateError(
      'VF_AEAT_EXTERNAL_GATE_RECONCILIATION_SCHEMA_INVALID',
      'Reconciliation evidence must be an AEAT official live reconciliation v1 document',
      'reconciliation',
    );
  }
  if (reconciliation.environment !== 'test') {
    throw gateError(
      'VF_AEAT_EXTERNAL_GATE_ENVIRONMENT_INVALID',
      'Reconciliation evidence must target the AEAT test environment',
      'reconciliation.environment',
    );
  }
  if (!SHA40_RE.test(String(reconciliation.sourceCommit ?? '')) || reconciliation.sourceCommit.toLowerCase() !== sourceCommit) {
    throw gateError(
      'VF_AEAT_EXTERNAL_GATE_SOURCE_COMMIT_MISMATCH',
      'Reconciliation evidence does not belong to the expected candidate commit',
      'reconciliation.sourceCommit',
    );
  }
  assertTimestamp(reconciliation.recordedAt, 'reconciliation.recordedAt');
  if (!['inspect', 'apply'].includes(reconciliation.mode)) {
    throw gateError('VF_AEAT_EXTERNAL_GATE_RECONCILIATION_MODE_INVALID', 'Reconciliation mode must be inspect or apply', 'reconciliation.mode');
  }
  assertSha256(reconciliation.jobIdSha256, 'reconciliation.jobIdSha256');
  assertSha256(reconciliation?.certificate?.pfxSha256, 'reconciliation.certificate.pfxSha256');

  const recordHashes = Array.isArray(reconciliation.entryRecordHashes) ? reconciliation.entryRecordHashes : [];
  if (!recordHashes.length) {
    throw gateError(
      'VF_AEAT_EXTERNAL_GATE_RECORD_HASHES_MISSING',
      'Reconciliation evidence must retain the fiscal record hash binding',
      'reconciliation.entryRecordHashes',
    );
  }
  recordHashes.forEach((hash, index) => assertSha256(hash, `reconciliation.entryRecordHashes[${index}]`));
  if (!recordHashes.some((hash) => hash.toLowerCase() === acceptedRecordHash.toLowerCase())) {
    throw gateError(
      'VF_AEAT_EXTERNAL_GATE_ACCEPTED_RECORD_MISMATCH',
      'Reconciliation evidence is not bound to the accepted fiscal record',
      'reconciliation.entryRecordHashes',
    );
  }

  const assessment = reconciliation.assessment;
  if (assessment?.outcome !== 'received' || assessment?.allReceived !== true || assessment?.shouldReissue !== false) {
    throw gateError(
      'VF_AEAT_EXTERNAL_GATE_RECONCILIATION_UNRESOLVED',
      'Official reconciliation must confirm all records and prohibit blind reissue',
      'reconciliation.assessment',
    );
  }
  if (!Number.isInteger(assessment.entryCount) || assessment.entryCount < 1) {
    throw gateError(
      'VF_AEAT_EXTERNAL_GATE_RECONCILIATION_ENTRIES_INVALID',
      'Reconciliation evidence must contain at least one assessed entry',
      'reconciliation.assessment.entryCount',
    );
  }
  const entries = Array.isArray(assessment.entries) ? assessment.entries : [];
  if (entries.length !== assessment.entryCount || entries.some((entry) => entry?.outcome !== 'received' || entry?.received !== true)) {
    throw gateError(
      'VF_AEAT_EXTERNAL_GATE_RECONCILIATION_ENTRIES_UNRESOLVED',
      'Every reconciliation entry must be confirmed as received',
      'reconciliation.assessment.entries',
    );
  }

  if (reconciliation.mode === 'inspect') {
    if (assessment.applied !== false || reconciliation.beforeState !== 'reconciliation_required' || reconciliation.afterState !== 'reconciliation_required') {
      throw gateError(
        'VF_AEAT_EXTERNAL_GATE_INSPECT_STATE_INVALID',
        'Inspect evidence must leave the quarantined job unchanged',
        'reconciliation',
      );
    }
  } else if (assessment.applied !== true || reconciliation.beforeState !== 'reconciliation_required' || reconciliation.afterState !== 'completed') {
    throw gateError(
      'VF_AEAT_EXTERNAL_GATE_APPLY_STATE_INVALID',
      'Apply evidence must complete only an exactly reconciled quarantined job',
      'reconciliation',
    );
  }

  return {
    mode: reconciliation.mode,
    entryCount: assessment.entryCount,
    pfxSha256: reconciliation.certificate.pfxSha256,
    evidenceSha256: stableFingerprint(reconciliation),
  };
}

export function verifyAeatExternalGateEvidence({ accepted, rejected, reconciliation, sourceCommit }) {
  const commit = String(sourceCommit ?? '').trim().toLowerCase();
  if (!SHA40_RE.test(commit)) {
    throw gateError('VF_AEAT_EXTERNAL_GATE_SOURCE_COMMIT_REQUIRED', 'A 40-character candidate source commit is required', 'sourceCommit');
  }

  const submissionBundle = verifyAeatEvidenceBundle({ accepted, rejected, sourceCommit: commit });
  assertSha256(accepted?.summary?.recordHash, 'accepted.summary.recordHash');
  const reconciliationSummary = verifyReconciliationEvidence(reconciliation, commit, accepted.summary.recordHash);

  return {
    schemaVersion: 1,
    gate: 'aeat-test-external-gate-evidence',
    status: 'external_gate_evidence_complete',
    sourceCommit: commit,
    verified: {
      acceptedSubmission: true,
      deterministicRejectedSubmission: true,
      officialReconciliation: true,
      acceptedRecordBoundToReconciliation: true,
      artifactVersions: true,
      waitSecondsObserved: true,
      sanitizedEvidence: true,
    },
    aeatArtifacts: submissionBundle.aeatArtifacts,
    observedWaitSeconds: submissionBundle.observedWaitSeconds,
    evidenceFingerprints: {
      acceptedXmlSha256: submissionBundle.evidenceFingerprints.acceptedXmlSha256,
      acceptedCsvSha256: submissionBundle.evidenceFingerprints.acceptedCsvSha256,
      rejectedXmlSha256: submissionBundle.evidenceFingerprints.rejectedXmlSha256,
      reconciliationSha256: reconciliationSummary.evidenceSha256,
    },
    reconciliation: {
      mode: reconciliationSummary.mode,
      entryCount: reconciliationSummary.entryCount,
      certificatePfxSha256: reconciliationSummary.pfxSha256,
    },
    releaseUnblocked: false,
    automaticIssueClosure: false,
    nextManualSteps: [
      'review_external_evidence',
      'close_github_issue_6_if_accepted',
      'update_release_gate_config_in_a_separate_reviewed_change',
      'prepare_final_responsible_declaration_for_the_exact_release_version',
    ],
  };
}

export function parseExternalGateEvidenceOptions(argv = []) {
  const allowed = new Set(['--accepted', '--rejected', '--reconciliation', '--source-commit']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) throw gateError('VF_AEAT_EXTERNAL_GATE_OPTION_UNKNOWN', `Unsupported option: ${flag}`, flag);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw gateError('VF_AEAT_EXTERNAL_GATE_OPTION_VALUE_REQUIRED', `${flag} requires a value`, flag);
    }
    index += 1;
  }
  const read = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };
  const acceptedPath = read('--accepted');
  const rejectedPath = read('--rejected');
  const reconciliationPath = read('--reconciliation');
  const sourceCommit = read('--source-commit');
  if (!acceptedPath || !rejectedPath || !reconciliationPath || !sourceCommit) {
    throw gateError(
      'VF_AEAT_EXTERNAL_GATE_OPTIONS_REQUIRED',
      '--accepted, --rejected, --reconciliation and --source-commit are required',
    );
  }
  return { acceptedPath, rejectedPath, reconciliationPath, sourceCommit };
}
