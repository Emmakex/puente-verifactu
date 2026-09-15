import { AEAT_ARTIFACTS } from '../../packages/aeat-adapter/src/constants.mjs';

const SHA40_RE = /^[0-9a-f]{40}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const FORBIDDEN_RAW_KEYS = new Set([
  'pfx',
  'pfxpath',
  'passphrase',
  'privatekey',
  'certificate',
  'xml',
  'soap',
  'rawsoap',
  'rawresponse',
  'csv',
  'errordescription',
]);

function verificationError(code, message, field = null) {
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
      throw verificationError(
        'VF_AEAT_EVIDENCE_RAW_SENSITIVE_FIELD',
        'Evidence contains a raw field that is forbidden in the sanitized bundle',
        `${path}.${key}`,
      );
    }
    assertNoRawSensitiveKeys(child, `${path}.${key}`);
  }
}

function assertSha256(value, field) {
  if (!SHA256_RE.test(String(value ?? ''))) {
    throw verificationError('VF_AEAT_EVIDENCE_HASH_INVALID', `${field} must contain a SHA-256 hex digest`, field);
  }
}

function assertTimestamp(value, field) {
  const text = String(value ?? '');
  if (!text || Number.isNaN(Date.parse(text))) {
    throw verificationError('VF_AEAT_EVIDENCE_TIMESTAMP_INVALID', `${field} must contain an ISO-compatible timestamp`, field);
  }
}

function expectedArtifacts() {
  return {
    verifiedAt: AEAT_ARTIFACTS.verifiedAt,
    webServiceDocumentVersion: AEAT_ARTIFACTS.webServiceDocumentVersion,
    validationsDocumentVersion: AEAT_ARTIFACTS.validationsDocumentVersion,
    schemaGeneration: AEAT_ARTIFACTS.schemaGeneration,
    recordVersion: AEAT_ARTIFACTS.recordVersion,
  };
}

function assertArtifacts(actual, label) {
  const expected = expectedArtifacts();
  if (!actual || typeof actual !== 'object') {
    throw verificationError('VF_AEAT_EVIDENCE_ARTIFACTS_MISSING', `${label} does not pin AEAT artifact versions`, `${label}.summary.aeatArtifacts`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw verificationError(
        'VF_AEAT_EVIDENCE_ARTIFACT_VERSION_MISMATCH',
        `${label} was generated against a different AEAT artifact version`,
        `${label}.summary.aeatArtifacts.${key}`,
      );
    }
  }
  return expected;
}

function assertCommonEvidence(evidence, label, sourceCommit) {
  assertNoRawSensitiveKeys(evidence);
  if (evidence?.schemaVersion !== 1 || evidence?.gate !== 'aeat-test-live') {
    throw verificationError('VF_AEAT_EVIDENCE_SCHEMA_INVALID', `${label} is not an AEAT live-gate v1 evidence document`, label);
  }
  if (evidence.action !== 'submit') {
    throw verificationError('VF_AEAT_EVIDENCE_NOT_SUBMISSION', `${label} must come from a real submit action`, `${label}.action`);
  }
  if (!SHA40_RE.test(String(evidence.sourceCommit ?? ''))) {
    throw verificationError('VF_AEAT_EVIDENCE_SOURCE_COMMIT_INVALID', `${label} source commit is invalid`, `${label}.sourceCommit`);
  }
  if (evidence.sourceCommit.toLowerCase() !== sourceCommit) {
    throw verificationError('VF_AEAT_EVIDENCE_SOURCE_COMMIT_MISMATCH', `${label} does not belong to the expected source commit`, `${label}.sourceCommit`);
  }
  assertTimestamp(evidence.recordedAt, `${label}.recordedAt`);
  if (evidence?.summary?.mode !== 'test') {
    throw verificationError('VF_AEAT_EVIDENCE_ENVIRONMENT_INVALID', `${label} must target the AEAT test environment`, `${label}.summary.mode`);
  }
  assertSha256(evidence?.summary?.xmlSha256, `${label}.summary.xmlSha256`);
  assertSha256(evidence?.summary?.recordHash, `${label}.summary.recordHash`);
  return assertArtifacts(evidence?.summary?.aeatArtifacts, label);
}

function assertAccepted(evidence, sourceCommit) {
  const artifacts = assertCommonEvidence(evidence, 'accepted', sourceCommit);
  if (evidence.expectedStatus !== 'accepted' || evidence?.result?.status !== 'accepted') {
    throw verificationError('VF_AEAT_EVIDENCE_ACCEPTED_STATUS_INVALID', 'Accepted evidence must expect and receive accepted', 'accepted.result.status');
  }
  if (evidence.result.csvPresent !== true) {
    throw verificationError('VF_AEAT_EVIDENCE_ACCEPTED_CSV_MISSING', 'Accepted evidence must confirm an AEAT CSV fingerprint', 'accepted.result.csvPresent');
  }
  assertSha256(evidence.result.csvSha256, 'accepted.result.csvSha256');
  return artifacts;
}

function assertRejected(evidence, sourceCommit) {
  const artifacts = assertCommonEvidence(evidence, 'rejected', sourceCommit);
  if (evidence.expectedStatus !== 'rejected' || evidence?.result?.status !== 'rejected') {
    throw verificationError('VF_AEAT_EVIDENCE_REJECTED_STATUS_INVALID', 'Rejected evidence must expect and receive rejected', 'rejected.result.status');
  }
  const records = Array.isArray(evidence?.result?.records) ? evidence.result.records : [];
  const hasDiagnostic = Boolean(evidence?.result?.errorCode)
    || records.some((item) => item?.status === 'rejected' && Boolean(item?.errorCode));
  if (!hasDiagnostic) {
    throw verificationError('VF_AEAT_EVIDENCE_REJECTED_DIAGNOSTIC_MISSING', 'Rejected evidence must retain a normalized rejection code', 'rejected.result');
  }
  return artifacts;
}

function collectWaitSeconds(...evidenceDocuments) {
  const values = evidenceDocuments
    .map((item) => item?.result?.waitSeconds)
    .filter((value) => Number.isInteger(value) && value >= 0);
  if (!values.length) {
    throw verificationError(
      'VF_AEAT_EVIDENCE_WAIT_SECONDS_MISSING',
      'At least one live response must record TiempoEsperaEnvio as a non-negative integer',
      'result.waitSeconds',
    );
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

export function verifyAeatEvidenceBundle({ accepted, rejected, sourceCommit }) {
  const commit = String(sourceCommit ?? '').trim().toLowerCase();
  if (!SHA40_RE.test(commit)) {
    throw verificationError('VF_AEAT_EVIDENCE_SOURCE_COMMIT_REQUIRED', 'A 40-character candidate source commit is required', 'sourceCommit');
  }

  const acceptedArtifacts = assertAccepted(accepted, commit);
  const rejectedArtifacts = assertRejected(rejected, commit);
  if (JSON.stringify(acceptedArtifacts) !== JSON.stringify(rejectedArtifacts)) {
    throw verificationError('VF_AEAT_EVIDENCE_ARTIFACT_VERSION_MISMATCH', 'Accepted and rejected evidence do not pin the same AEAT artifacts', 'summary.aeatArtifacts');
  }
  const observedWaitSeconds = collectWaitSeconds(accepted, rejected);

  return {
    schemaVersion: 1,
    gate: 'aeat-test-live-evidence-bundle',
    status: 'partial',
    sourceCommit: commit,
    verified: {
      acceptedSubmission: true,
      rejectedSubmission: true,
      artifactVersions: true,
      waitSecondsObserved: true,
      sanitizedEvidence: true,
    },
    aeatArtifacts: acceptedArtifacts,
    observedWaitSeconds,
    evidenceFingerprints: {
      acceptedXmlSha256: accepted.summary.xmlSha256,
      acceptedCsvSha256: accepted.result.csvSha256,
      rejectedXmlSha256: rejected.summary.xmlSha256,
    },
    remainingExternalEvidence: ['reconciliation'],
    releaseUnblocked: false,
  };
}

export function parseEvidenceVerifierOptions(argv = []) {
  const readValue = (flag) => {
    const index = argv.indexOf(flag);
    if (index < 0) return null;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw verificationError('VF_AEAT_EVIDENCE_OPTION_VALUE_REQUIRED', `${flag} requires a value`, flag);
    }
    return value;
  };

  const acceptedPath = readValue('--accepted');
  const rejectedPath = readValue('--rejected');
  const sourceCommit = readValue('--source-commit');
  if (!acceptedPath || !rejectedPath || !sourceCommit) {
    throw verificationError(
      'VF_AEAT_EVIDENCE_OPTIONS_REQUIRED',
      '--accepted, --rejected and --source-commit are required',
    );
  }
  return { acceptedPath, rejectedPath, sourceCommit };
}
