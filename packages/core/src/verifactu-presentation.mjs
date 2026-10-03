import { isAmount } from './decimal.mjs';

export const VERIFACTU_QR_SPECIFICATION = Object.freeze({
  version: '0.5.0',
  publishedAt: '2025-12-10',
  errorCorrection: 'M',
  minSizeMm: 30,
  maxSizeMm: 40,
  minQuietZoneMm: 2,
  recommendedQuietZoneMm: 6,
  requiredPrefixText: 'QR tributario:',
  verificationText: 'Factura verificable en la sede electrónica de la AEAT',
});

export const VERIFACTU_QR_ENDPOINTS = Object.freeze({
  test: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR',
  production: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR',
});

const LANGUAGES = new Set(['gl', 'ca', 'eu', 'es', 'va', 'en']);
const ASCII_PRINTABLE_RE = /^[\x20-\x7E]+$/;

function requiredString(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function assertPrintableAscii(value, name, maxLength) {
  const text = requiredString(value, name);
  if (!ASCII_PRINTABLE_RE.test(text)) throw new TypeError(`${name} must use printable ASCII characters`);
  if (text.length > maxLength) throw new TypeError(`${name} exceeds ${maxLength} characters`);
  return text;
}

function normalizeNif(value) {
  const nif = assertPrintableAscii(value, 'issuerTaxId', 9).toUpperCase();
  if (nif.length !== 9) throw new TypeError('issuerTaxId must contain 9 characters');
  return nif;
}

function normalizeIssueDate(value) {
  const input = requiredString(value, 'issueDate');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) throw new TypeError('issueDate must use YYYY-MM-DD');
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)
  ) {
    throw new TypeError('issueDate is not a valid calendar date');
  }
  return `${day}-${month}-${year}`;
}

function normalizeAmount(value) {
  const amount = requiredString(value, 'totalAmount');
  if (!isAmount(amount)) throw new TypeError('totalAmount must be a decimal string with at most 2 decimals');
  const unsigned = amount.startsWith('-') ? amount.slice(1) : amount;
  const [whole] = unsigned.split('.');
  if (whole.length > 12) throw new TypeError('totalAmount exceeds 12 integer digits');
  return amount;
}

function normalizeEnvironment(value) {
  const environment = requiredString(value, 'environment');
  if (!(environment in VERIFACTU_QR_ENDPOINTS)) {
    throw new TypeError('environment must be test or production');
  }
  return environment;
}

export function buildVerifactuQrUrl({
  environment,
  issuerTaxId,
  invoiceNumber,
  issueDate,
  totalAmount,
  language = null,
} = {}) {
  const endpoint = VERIFACTU_QR_ENDPOINTS[normalizeEnvironment(environment)];
  const nif = normalizeNif(issuerTaxId);
  const numserie = assertPrintableAscii(invoiceNumber, 'invoiceNumber', 60);
  const fecha = normalizeIssueDate(issueDate);
  const importe = normalizeAmount(totalAmount);

  const params = new URLSearchParams();
  params.set('nif', nif);
  params.set('numserie', numserie);
  params.set('fecha', fecha);
  params.set('importe', importe);

  if (language != null && String(language).trim() !== '') {
    const normalizedLanguage = String(language).trim().toLowerCase();
    if (!LANGUAGES.has(normalizedLanguage)) {
      throw new TypeError('language must be one of gl, ca, eu, es, va, en');
    }
    params.set('idioma', normalizedLanguage);
  }

  return `${endpoint}?${params.toString()}`;
}

export function buildVerifactuInvoicePresentation(input = {}) {
  return Object.freeze({
    mode: 'VERI*FACTU',
    qr: Object.freeze({
      url: buildVerifactuQrUrl(input),
      prefixText: VERIFACTU_QR_SPECIFICATION.requiredPrefixText,
      errorCorrection: VERIFACTU_QR_SPECIFICATION.errorCorrection,
      minSizeMm: VERIFACTU_QR_SPECIFICATION.minSizeMm,
      maxSizeMm: VERIFACTU_QR_SPECIFICATION.maxSizeMm,
      minQuietZoneMm: VERIFACTU_QR_SPECIFICATION.minQuietZoneMm,
      recommendedQuietZoneMm: VERIFACTU_QR_SPECIFICATION.recommendedQuietZoneMm,
      placement: 'first-page-preeminent',
    }),
    verificationText: VERIFACTU_QR_SPECIFICATION.verificationText,
    structuredInvoice: Object.freeze({
      verificationUrlFieldRequired: true,
    }),
    specificationVersion: VERIFACTU_QR_SPECIFICATION.version,
  });
}
