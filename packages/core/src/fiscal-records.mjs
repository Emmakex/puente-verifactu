import { createHash } from 'node:crypto';
import { buildAltaHashMaterial, buildAnulacionHashMaterial, calculateAltaHash, calculateAnulacionHash } from './hash.mjs';
import { validateInvoiceIntent } from './validation.mjs';

function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSort(value[key])]));
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(stableSort(value))).digest('hex');
}

export function composeFiscalNumber({ series = '', number }) {
  const rawNumber = String(number ?? '').trim();
  if (!rawNumber) throw new TypeError('Invoice number is required');
  const value = `${String(series ?? '').trim()}${rawNumber}`;
  if (value.length > 60) {
    const error = new Error('AEAT NumSerieFactura cannot exceed 60 characters');
    error.code = 'VF_FISCAL_NUMBER_TOO_LONG';
    throw error;
  }
  return value;
}

export function buildChainKey(organizationId, sif) {
  const systemId = String(sif?.systemId ?? '').trim();
  const installationNumber = String(sif?.installationNumber ?? '').trim();
  if (!organizationId || !systemId || !installationNumber) throw new TypeError('organizationId, sif.systemId and sif.installationNumber are required');
  return [organizationId, systemId, installationNumber].join('\u001f');
}

function sumDecimalStrings(values) {
  const toScaled = (value) => {
    const text = String(value ?? '0').trim();
    const match = text.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
    if (!match) throw new TypeError(`Invalid monetary value: ${value}`);
    const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
    return match[1] === '-' ? -cents : cents;
  };
  const fromScaled = (scaled) => {
    const sign = scaled < 0n ? '-' : '';
    const abs = scaled < 0n ? -scaled : scaled;
    const units = abs / 100n;
    const cents = String(abs % 100n).padStart(2, '0');
    return `${sign}${units}.${cents}`;
  };
  return fromScaled(values.reduce((sum, value) => sum + toScaled(value), 0n));
}

function surchargeAmounts(intent) {
  const lineAmounts = (intent.taxBreakdown ?? []).filter((line) => line.surchargeAmount !== undefined).map((line) => line.surchargeAmount);
  if (lineAmounts.length > 0) return lineAmounts;
  return (intent.adjustments ?? []).filter((item) => item.type === 'surcharge').map((item) => item.amount);
}

export function deriveEuroAmounts(intent, euroAmounts) {
  if (intent.currency === 'EUR') {
    return {
      quotaTotal: sumDecimalStrings([intent.totals.taxAmount, ...surchargeAmounts(intent)]),
      totalAmount: intent.totals.totalAmount,
    };
  }
  if (!euroAmounts?.quotaTotal || !euroAmounts?.totalAmount) {
    const error = new Error('Non-EUR invoices require explicit converted quotaTotal and totalAmount in EUR');
    error.code = 'VF_FISCAL_EUR_CONVERSION_REQUIRED';
    throw error;
  }
  return { quotaTotal: euroAmounts.quotaTotal, totalAmount: euroAmounts.totalAmount };
}

function previousReference(previous) {
  if (!previous) return null;
  return {
    issuerTaxId: previous.invoice.issuerTaxId,
    fiscalNumber: previous.invoice.fiscalNumber,
    issueDate: previous.invoice.issueDate,
    hash: previous.hash,
  };
}

export function createAltaFiscalRecord(intent, { sif, generatedAt, previous = null, euroAmounts, sequence = previous ? previous.sequence + 1 : 1 } = {}) {
  const validation = validateInvoiceIntent(intent);
  if (!validation.ok) {
    const error = new Error('InvoiceIntent is not valid for fiscalization');
    error.code = 'VF_FISCAL_INTENT_INVALID';
    error.details = validation.errors;
    throw error;
  }
  if (!intent?.issuer?.taxId) {
    const error = new Error('Issuer taxId is required to fiscalize a record');
    error.code = 'VF_FISCAL_ISSUER_TAX_ID_REQUIRED';
    throw error;
  }
  const fiscalNumber = composeFiscalNumber(intent);
  const amounts = deriveEuroAmounts(intent, euroAmounts);
  const previousHash = previous?.hash ?? '';
  const hashInput = {
    issuerTaxId: intent.issuer.taxId,
    fiscalNumber,
    issueDate: intent.issueDate,
    invoiceType: intent.invoiceType,
    quotaTotal: amounts.quotaTotal,
    totalAmount: amounts.totalAmount,
    previousHash,
    generatedAt,
  };
  const record = {
    schemaVersion: 1,
    recordType: 'alta',
    sequence,
    organizationId: intent.organizationId,
    chainKey: buildChainKey(intent.organizationId, sif),
    sif: { systemId: String(sif.systemId), installationNumber: String(sif.installationNumber) },
    invoice: { issuerTaxId: intent.issuer.taxId, fiscalNumber, issueDate: intent.issueDate },
    invoiceType: intent.invoiceType,
    quotaTotal: amounts.quotaTotal,
    totalAmount: amounts.totalAmount,
    firstRecord: !previous,
    previous: previousReference(previous),
    generatedAt,
    hashType: '01',
    hash: calculateAltaHash(hashInput),
    source: {
      installationId: intent.installationId,
      sourceSystem: intent.sourceSystem,
      sourceInvoiceId: intent.sourceInvoiceId,
    },
  };
  return deepFreeze(record);
}

export function createAnulacionFiscalRecord(request, { sif, generatedAt, previous = null, sequence = previous ? previous.sequence + 1 : 1 } = {}) {
  const fiscalNumber = composeFiscalNumber(request);
  const hashInput = {
    issuerTaxId: request.issuerTaxId,
    fiscalNumber,
    issueDate: request.issueDate,
    previousHash: previous?.hash ?? '',
    generatedAt,
  };
  const record = {
    schemaVersion: 1,
    recordType: 'anulacion',
    sequence,
    organizationId: request.organizationId,
    chainKey: buildChainKey(request.organizationId, sif),
    sif: { systemId: String(sif.systemId), installationNumber: String(sif.installationNumber) },
    invoice: { issuerTaxId: request.issuerTaxId, fiscalNumber, issueDate: request.issueDate },
    firstRecord: !previous,
    previous: previousReference(previous),
    generatedAt,
    hashType: '01',
    hash: calculateAnulacionHash(hashInput),
    source: { sourceCancellationId: request.sourceCancellationId },
  };
  return deepFreeze(record);
}

export function materialForFiscalRecord(record) {
  const common = {
    issuerTaxId: record.invoice.issuerTaxId,
    fiscalNumber: record.invoice.fiscalNumber,
    issueDate: record.invoice.issueDate,
    previousHash: record.previous?.hash ?? '',
    generatedAt: record.generatedAt,
  };
  return record.recordType === 'alta'
    ? buildAltaHashMaterial({ ...common, invoiceType: record.invoiceType, quotaTotal: record.quotaTotal, totalAmount: record.totalAmount })
    : buildAnulacionHashMaterial(common);
}

export function verifyFiscalRecord(record) {
  const expected = record.recordType === 'alta'
    ? calculateAltaHash({
        issuerTaxId: record.invoice.issuerTaxId,
        fiscalNumber: record.invoice.fiscalNumber,
        issueDate: record.invoice.issueDate,
        invoiceType: record.invoiceType,
        quotaTotal: record.quotaTotal,
        totalAmount: record.totalAmount,
        previousHash: record.previous?.hash ?? '',
        generatedAt: record.generatedAt,
      })
    : calculateAnulacionHash({
        issuerTaxId: record.invoice.issuerTaxId,
        fiscalNumber: record.invoice.fiscalNumber,
        issueDate: record.invoice.issueDate,
        previousHash: record.previous?.hash ?? '',
        generatedAt: record.generatedAt,
      });
  return { ok: expected === record.hash, expected, actual: record.hash };
}

export function fiscalOperationFingerprint(payload) {
  return fingerprint(payload);
}
