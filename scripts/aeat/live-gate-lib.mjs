import { createHash } from 'node:crypto';
import { AEAT_ENDPOINTS, AEAT_ARTIFACTS } from '../../packages/aeat-adapter/src/constants.mjs';
import { createAltaFiscalRecord } from '../../packages/core/src/fiscal-records.mjs';
import { timestampForZone } from '../../packages/core/src/hash.mjs';

const EXPECTED_STATUSES = new Set(['accepted', 'partial', 'rejected', 'fault']);
const CONTROLLED_REJECTION_PROFILES = new Set(['future-issue-date']);

function required(env, key) {
  const value = String(env?.[key] ?? '').trim();
  if (!value) {
    const error = new Error(`${key} is required for the AEAT live gate`);
    error.code = 'VF_AEAT_GATE_CONFIG_REQUIRED';
    error.field = key;
    throw error;
  }
  return value;
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function nextIsoDate(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function sha256(value) {
  if (value == null || value === '') return null;
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    const error = new Error(`${flag} requires a value`);
    error.code = 'VF_AEAT_GATE_OPTION_VALUE_REQUIRED';
    error.field = flag;
    throw error;
  }
  return value;
}

export function maskTaxId(value) {
  const text = String(value ?? '');
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}${'*'.repeat(Math.max(1, text.length - 4))}${text.slice(-2)}`;
}

export function buildLiveGateFixture(env = process.env, now = new Date(), { rejectionProfile = null } = {}) {
  const timeZone = String(env.AEAT_TEST_TIMEZONE || 'Europe/Madrid').trim();
  const generatedAt = timestampForZone(now, timeZone);
  const localToday = generatedAt.slice(0, 10);
  if (rejectionProfile && !CONTROLLED_REJECTION_PROFILES.has(rejectionProfile)) {
    const error = new Error(`Unsupported controlled rejection profile: ${rejectionProfile}`);
    error.code = 'VF_AEAT_GATE_REJECTION_PROFILE_INVALID';
    error.field = '--rejection-profile';
    throw error;
  }
  if (rejectionProfile === 'future-issue-date' && String(env.AEAT_TEST_ISSUE_DATE ?? '').trim()) {
    const error = new Error('future-issue-date controls the issue date and cannot be combined with AEAT_TEST_ISSUE_DATE');
    error.code = 'VF_AEAT_GATE_REJECTION_PROFILE_DATE_CONFLICT';
    error.field = 'AEAT_TEST_ISSUE_DATE';
    throw error;
  }
  const issueDate = rejectionProfile === 'future-issue-date'
    ? nextIsoDate(localToday)
    : String(env.AEAT_TEST_ISSUE_DATE || localToday).trim();
  const suffix = compactTimestamp(now);

  const issuer = {
    name: required(env, 'AEAT_TEST_ISSUER_NAME'),
    taxId: required(env, 'AEAT_TEST_ISSUER_NIF'),
  };

  const sif = {
    producerName: String(env.AEAT_TEST_PRODUCER_NAME || 'Kairoseth Extensions').trim(),
    producerTaxId: required(env, 'AEAT_TEST_PRODUCER_NIF'),
    softwareName: String(env.AEAT_TEST_SOFTWARE_NAME || 'Puente VeriFactu').trim(),
    systemId: String(env.AEAT_TEST_SYSTEM_ID || 'PV').trim(),
    version: String(env.AEAT_TEST_SOFTWARE_VERSION || '0.1.0').trim(),
    installationNumber: String(env.AEAT_TEST_INSTALLATION_NUMBER || `GATE-${suffix}`).trim(),
    onlyVerifactu: true,
    possibleMultiTaxpayer: true,
    multipleTaxpayers: false,
  };

  const series = String(env.AEAT_TEST_SERIES || 'PVGATE-').trim();
  const number = String(env.AEAT_TEST_NUMBER || suffix).trim();
  const sourceInvoiceId = String(env.AEAT_TEST_SOURCE_INVOICE_ID || `gate-${suffix}`).trim();

  const intent = {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: String(env.AEAT_TEST_ORGANIZATION_ID || 'aeat-live-gate').trim(),
    installationId: 'aeat-live-gate-source',
    sourceSystem: 'aeat-live-gate',
    sourceInvoiceId,
    series,
    number,
    issueDate,
    invoiceType: 'F2',
    description: String(env.AEAT_TEST_DESCRIPTION || 'Puente VeriFactu - prueba controlada de conectividad AEAT').trim(),
    issuer,
    recipients: [],
    currency: 'EUR',
    taxBreakdown: [{
      taxCode: '01',
      regimeKey: '01',
      operationClass: 'S1',
      rate: '21',
      baseAmount: '1.00',
      taxAmount: '0.21',
    }],
    adjustments: [],
    totals: {
      baseAmount: '1.00',
      taxAmount: '0.21',
      totalAmount: '1.21',
    },
  };

  const record = createAltaFiscalRecord(intent, { sif, generatedAt });
  return { issuer, sif, intent, record, timeZone, rejectionProfile };
}

export function parseLiveGateOptions(argv = [], env = process.env) {
  const send = argv.includes('--send');
  const showXml = argv.includes('--show-xml');
  if (send && env.AEAT_LIVE_SEND !== 'YES') {
    const error = new Error('Live AEAT submission requires both --send and AEAT_LIVE_SEND=YES');
    error.code = 'VF_AEAT_GATE_SEND_GUARD';
    throw error;
  }
  if (send && showXml) {
    const error = new Error('--show-xml is restricted to dry-run executions');
    error.code = 'VF_AEAT_GATE_XML_WITH_SEND_FORBIDDEN';
    throw error;
  }

  const expectedStatus = argValue(argv, '--expect') ?? (send ? 'accepted' : null);
  if (expectedStatus != null && !EXPECTED_STATUSES.has(expectedStatus)) {
    const error = new Error(`Unsupported expected AEAT status: ${expectedStatus}`);
    error.code = 'VF_AEAT_GATE_EXPECT_STATUS_INVALID';
    error.field = '--expect';
    throw error;
  }

  const evidenceOutput = argValue(argv, '--evidence-output');
  const sourceCommit = argValue(argv, '--source-commit');
  if (evidenceOutput && !/^[0-9a-f]{40}$/i.test(sourceCommit ?? '')) {
    const error = new Error('--evidence-output requires --source-commit with a 40-character commit SHA');
    error.code = 'VF_AEAT_GATE_SOURCE_COMMIT_REQUIRED';
    error.field = '--source-commit';
    throw error;
  }

  const rejectionProfile = argValue(argv, '--rejection-profile');
  if (rejectionProfile && !CONTROLLED_REJECTION_PROFILES.has(rejectionProfile)) {
    const error = new Error(`Unsupported controlled rejection profile: ${rejectionProfile}`);
    error.code = 'VF_AEAT_GATE_REJECTION_PROFILE_INVALID';
    error.field = '--rejection-profile';
    throw error;
  }
  if (rejectionProfile && !send) {
    const error = new Error('Controlled rejection profile is only available on a real --send execution');
    error.code = 'VF_AEAT_GATE_REJECTION_SEND_REQUIRED';
    throw error;
  }
  if (rejectionProfile && expectedStatus !== 'rejected') {
    const error = new Error('Controlled rejection profile requires --expect rejected');
    error.code = 'VF_AEAT_GATE_REJECTION_EXPECT_REJECTED';
    throw error;
  }
  if (rejectionProfile && env.AEAT_CONTROLLED_REJECTION !== 'YES') {
    const error = new Error('Controlled rejection profile requires AEAT_CONTROLLED_REJECTION=YES');
    error.code = 'VF_AEAT_GATE_REJECTION_GUARD';
    throw error;
  }
  if (rejectionProfile === 'future-issue-date' && String(env.AEAT_TEST_ISSUE_DATE ?? '').trim()) {
    const error = new Error('future-issue-date cannot be combined with AEAT_TEST_ISSUE_DATE');
    error.code = 'VF_AEAT_GATE_REJECTION_PROFILE_DATE_CONFLICT';
    error.field = 'AEAT_TEST_ISSUE_DATE';
    throw error;
  }

  const reconciliationSeedDb = argValue(argv, '--reconciliation-seed-db');
  const reconciliationSeedOutput = argValue(argv, '--reconciliation-seed-output');
  const seedRequested = Boolean(reconciliationSeedDb || reconciliationSeedOutput);
  if (seedRequested && (!reconciliationSeedDb || !reconciliationSeedOutput)) {
    const error = new Error('Controlled reconciliation seed requires both --reconciliation-seed-db and --reconciliation-seed-output');
    error.code = 'VF_AEAT_RECONCILIATION_SEED_PATHS_REQUIRED';
    throw error;
  }
  if (seedRequested && !send) {
    const error = new Error('Controlled reconciliation seed is only available on a real --send execution');
    error.code = 'VF_AEAT_RECONCILIATION_SEED_SEND_REQUIRED';
    throw error;
  }
  if (seedRequested && expectedStatus !== 'accepted') {
    const error = new Error('Controlled reconciliation seed requires --expect accepted');
    error.code = 'VF_AEAT_RECONCILIATION_SEED_EXPECT_ACCEPTED';
    throw error;
  }
  if (seedRequested && env.AEAT_RECONCILIATION_SEED !== 'YES') {
    const error = new Error('Controlled reconciliation seed requires AEAT_RECONCILIATION_SEED=YES');
    error.code = 'VF_AEAT_RECONCILIATION_SEED_GUARD';
    throw error;
  }
  if (seedRequested && !/^[0-9a-f]{40}$/i.test(sourceCommit ?? '')) {
    const error = new Error('Controlled reconciliation seed requires --source-commit with a 40-character commit SHA');
    error.code = 'VF_AEAT_RECONCILIATION_SEED_SOURCE_COMMIT_REQUIRED';
    error.field = '--source-commit';
    throw error;
  }

  return {
    send,
    showXml,
    expectedStatus,
    evidenceOutput,
    sourceCommit: sourceCommit?.toLowerCase() ?? null,
    rejectionProfile,
    reconciliationSeedDb,
    reconciliationSeedOutput,
  };
}

export function assertLiveSendAllowed(argv = [], env = process.env) {
  return parseLiveGateOptions(argv, env).send;
}

export function buildLiveGateSummary(fixture, xml) {
  const { issuer, sif, record, timeZone, rejectionProfile } = fixture;
  return {
    mode: 'test',
    endpoint: AEAT_ENDPOINTS.test,
    issuer: maskTaxId(issuer.taxId),
    installationNumber: sif.installationNumber,
    fiscalNumber: record.invoice.fiscalNumber,
    generatedAt: record.generatedAt,
    timeZone,
    controlledRejectionProfile: rejectionProfile ?? null,
    recordHash: record.hash,
    xmlBytes: Buffer.byteLength(xml, 'utf8'),
    xmlSha256: createHash('sha256').update(xml, 'utf8').digest('hex'),
    aeatArtifacts: {
      verifiedAt: AEAT_ARTIFACTS.verifiedAt,
      webServiceDocumentVersion: AEAT_ARTIFACTS.webServiceDocumentVersion,
      validationsDocumentVersion: AEAT_ARTIFACTS.validationsDocumentVersion,
      schemaGeneration: AEAT_ARTIFACTS.schemaGeneration,
      recordVersion: AEAT_ARTIFACTS.recordVersion,
    },
  };
}

export function sanitizeLiveGateResult(result) {
  return {
    kind: result?.kind ?? null,
    status: result?.status ?? null,
    csvPresent: Boolean(result?.csv),
    csvSha256: sha256(result?.csv),
    waitSeconds: result?.waitSeconds ?? null,
    errorCode: result?.errorCode ?? null,
    messageSha256: sha256(result?.message),
    records: (result?.records ?? []).map((item) => ({
      reference: item.reference ?? item.externalReference ?? null,
      status: item.status ?? null,
      errorCode: item.errorCode ?? null,
      errorDescriptionSha256: sha256(item.errorDescription),
      duplicate: Boolean(item.duplicate),
    })),
  };
}

export function buildLiveGateEvidence({ action, expectedStatus, sourceCommit, summary, result = null, recordedAt = new Date() }) {
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit ?? '')) {
    const error = new Error('A 40-character source commit SHA is required for evidence');
    error.code = 'VF_AEAT_GATE_SOURCE_COMMIT_REQUIRED';
    throw error;
  }
  return {
    schemaVersion: 1,
    gate: 'aeat-test-live',
    recordedAt: recordedAt.toISOString(),
    action,
    expectedStatus: expectedStatus ?? null,
    sourceCommit: sourceCommit.toLowerCase(),
    summary,
    result,
  };
}
