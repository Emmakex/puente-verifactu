import { createHash } from 'node:crypto';
import { AEAT_ENDPOINTS } from '../../packages/aeat-adapter/src/constants.mjs';
import { createAltaFiscalRecord } from '../../packages/core/src/fiscal-records.mjs';
import { timestampForZone } from '../../packages/core/src/hash.mjs';

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

export function maskTaxId(value) {
  const text = String(value ?? '');
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}${'*'.repeat(Math.max(1, text.length - 4))}${text.slice(-2)}`;
}

export function buildLiveGateFixture(env = process.env, now = new Date()) {
  const timeZone = String(env.AEAT_TEST_TIMEZONE || 'Europe/Madrid').trim();
  const generatedAt = timestampForZone(now, timeZone);
  const issueDate = String(env.AEAT_TEST_ISSUE_DATE || generatedAt.slice(0, 10)).trim();
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
    description: 'Puente VeriFactu - prueba controlada de conectividad AEAT',
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
  return { issuer, sif, intent, record, timeZone };
}

export function assertLiveSendAllowed(argv = [], env = process.env) {
  const send = argv.includes('--send');
  if (send && env.AEAT_LIVE_SEND !== 'YES') {
    const error = new Error('Live AEAT submission requires both --send and AEAT_LIVE_SEND=YES');
    error.code = 'VF_AEAT_GATE_SEND_GUARD';
    throw error;
  }
  return send;
}

export function buildLiveGateSummary(fixture, xml) {
  const { issuer, sif, record, timeZone } = fixture;
  return {
    mode: 'test',
    endpoint: AEAT_ENDPOINTS.test,
    issuer: maskTaxId(issuer.taxId),
    installationNumber: sif.installationNumber,
    fiscalNumber: record.invoice.fiscalNumber,
    generatedAt: record.generatedAt,
    timeZone,
    recordHash: record.hash,
    xmlBytes: Buffer.byteLength(xml, 'utf8'),
    xmlSha256: createHash('sha256').update(xml, 'utf8').digest('hex'),
  };
}
