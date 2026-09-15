import { createHash } from 'node:crypto';

const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function formatAeatDate(isoDate) {
  if (!ISO_DATE.test(String(isoDate ?? ''))) throw new TypeError('Expected issue date as YYYY-MM-DD');
  const [year, month, day] = isoDate.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) throw new TypeError('Issue date is not a real calendar date');
  return `${day}-${month}-${year}`;
}

export function assertAeatTimestamp(value) {
  if (!OFFSET_TIMESTAMP.test(String(value ?? '')) || Number.isNaN(Date.parse(value))) {
    throw new TypeError('FechaHoraHusoGenRegistro must include date, seconds and explicit UTC offset');
  }
  return value;
}

export function timestampForZone(date = new Date(), timeZone) {
  if (!timeZone) throw new TypeError('An IANA timeZone is required to generate FechaHoraHusoGenRegistro');
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'longOffset',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace('GMT', '');
  const value = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
  return assertAeatTimestamp(value);
}

export function normalizeHashDecimal(value) {
  const text = String(value ?? '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new TypeError(`Invalid decimal for hash: ${value}`);
  if (!text.includes('.')) return text;
  const normalized = text.replace(/0+$/, '').replace(/\.$/, '');
  return normalized === '-0' ? '0' : normalized;
}

export function sha256UpperHex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex').toUpperCase();
}

function previousHashValue(value) {
  const hash = String(value ?? '').trim();
  if (hash && !/^[0-9A-F]{64}$/.test(hash)) throw new TypeError('Previous Huella must be 64 uppercase hexadecimal characters');
  return hash;
}

function chainMaterial(entries) {
  return entries.map(([name, value]) => `${name}=${String(value ?? '').trim()}`).join('&');
}

export function buildAltaHashMaterial({ issuerTaxId, fiscalNumber, issueDate, invoiceType, quotaTotal, totalAmount, previousHash = '', generatedAt }) {
  assertAeatTimestamp(generatedAt);
  return chainMaterial([
    ['IDEmisorFactura', issuerTaxId],
    ['NumSerieFactura', fiscalNumber],
    ['FechaExpedicionFactura', formatAeatDate(issueDate)],
    ['TipoFactura', invoiceType],
    ['CuotaTotal', normalizeHashDecimal(quotaTotal)],
    ['ImporteTotal', normalizeHashDecimal(totalAmount)],
    ['Huella', previousHashValue(previousHash)],
    ['FechaHoraHusoGenRegistro', generatedAt],
  ]);
}

export function buildAnulacionHashMaterial({ issuerTaxId, fiscalNumber, issueDate, previousHash = '', generatedAt }) {
  assertAeatTimestamp(generatedAt);
  return chainMaterial([
    ['IDEmisorFacturaAnulada', issuerTaxId],
    ['NumSerieFacturaAnulada', fiscalNumber],
    ['FechaExpedicionFacturaAnulada', formatAeatDate(issueDate)],
    ['Huella', previousHashValue(previousHash)],
    ['FechaHoraHusoGenRegistro', generatedAt],
  ]);
}

export function calculateAltaHash(input) {
  return sha256UpperHex(buildAltaHashMaterial(input));
}

export function calculateAnulacionHash(input) {
  return sha256UpperHex(buildAnulacionHashMaterial(input));
}
