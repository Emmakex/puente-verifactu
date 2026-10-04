const ALLOWED_FIELDS = new Set([
  'series',
  'number',
  'issueDate',
  'invoiceType',
  'description',
  'issuer',
  'recipient',
  'tax',
  'rectification',
]);

const ALLOWED_VAT_RATES = new Set(['21', '10', '4']);
const INVOICE_TYPES = new Set(['F1', 'F2', 'R1', 'R2', 'R3', 'R4', 'R5']);

function fail(code, message, status = 400) {
  throw Object.assign(new Error(message), { code, status });
}

function text(value, name, { required = true, max = 200 } = {}) {
  const normalized = String(value ?? '').trim();
  if (required && !normalized) fail('VF_MANUAL_FIELD_REQUIRED', `${name} is required`);
  if (normalized.length > max) fail('VF_MANUAL_FIELD_INVALID', `${name} is too long`);
  return normalized;
}

function object(value, name, { required = true } = {}) {
  if (value == null && !required) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('VF_MANUAL_FIELD_INVALID', `${name} must be an object`);
  }
  return value;
}

function exactAmount(value, name) {
  const normalized = text(value, name, { max: 32 });
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    fail('VF_MANUAL_AMOUNT_INVALID', `${name} must use an exact decimal with up to two decimals`);
  }
  return normalized.includes('.') ? normalized.padEnd(normalized.indexOf('.') + 3, '0') : `${normalized}.00`;
}

function party(value, name, { required = true } = {}) {
  const data = object(value, name, { required });
  if (!data) return null;
  const allowed = new Set(['name', 'taxId']);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) fail('VF_MANUAL_FIELD_UNKNOWN', `Unsupported ${name} field: ${key}`);
  }
  const partyName = text(data.name, `${name}.name`, { required, max: 120 });
  const taxId = text(data.taxId, `${name}.taxId`, { required, max: 32 });
  if (!partyName && !taxId && !required) return null;
  if (!partyName || !taxId) fail('VF_MANUAL_PARTY_INCOMPLETE', `${name} requires both name and taxId`);
  return Object.freeze({ name: partyName, taxId });
}

function normalizeDate(value) {
  const normalized = text(value, 'issueDate', { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    fail('VF_MANUAL_DATE_INVALID', 'issueDate must use YYYY-MM-DD');
  }
  return normalized;
}

function normalizeInvoiceType(value) {
  const normalized = text(value, 'invoiceType', { max: 2 }).toUpperCase();
  if (!INVOICE_TYPES.has(normalized)) {
    fail('VF_MANUAL_INVOICE_TYPE_INVALID', 'Unsupported manual invoice type');
  }
  return normalized;
}

function normalizeTax(value) {
  const data = object(value, 'tax');
  const allowed = new Set(['rate', 'baseAmount', 'taxAmount', 'totalAmount']);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) fail('VF_MANUAL_FIELD_UNKNOWN', `Unsupported tax field: ${key}`);
  }
  const rate = text(data.rate, 'tax.rate', { max: 8 });
  if (!ALLOWED_VAT_RATES.has(rate)) {
    fail(
      'VF_MANUAL_TAX_PROFILE_UNSUPPORTED',
      'Manual capture v1 supports standard domestic VAT rates 21, 10 and 4 only',
      422,
    );
  }
  return Object.freeze({
    rate,
    baseAmount: exactAmount(data.baseAmount, 'tax.baseAmount'),
    taxAmount: exactAmount(data.taxAmount, 'tax.taxAmount'),
    totalAmount: exactAmount(data.totalAmount, 'tax.totalAmount'),
  });
}

function normalizeRectification(value, invoiceType) {
  const rectifying = /^R[1-5]$/.test(invoiceType);
  if (!rectifying) {
    if (value != null) fail('VF_MANUAL_RECTIFICATION_UNEXPECTED', 'rectification is only valid for R1-R5');
    return null;
  }
  const data = object(value, 'rectification');
  const allowed = new Set(['type', 'correctedBaseAmount', 'correctedTaxAmount']);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) fail('VF_MANUAL_FIELD_UNKNOWN', `Unsupported rectification field: ${key}`);
  }
  const type = text(data.type, 'rectification.type', { max: 1 }).toUpperCase();
  if (!['I', 'S'].includes(type)) {
    fail('VF_MANUAL_RECTIFICATION_TYPE_INVALID', 'rectification.type must be I or S');
  }
  if (type === 'I') return Object.freeze({ type });
  return Object.freeze({
    type,
    correctedBaseAmount: exactAmount(data.correctedBaseAmount, 'rectification.correctedBaseAmount'),
    correctedTaxAmount: exactAmount(data.correctedTaxAmount, 'rectification.correctedTaxAmount'),
  });
}

export function manualCaptureToIntent(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('VF_MANUAL_INPUT_INVALID', 'Manual capture input must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(key)) fail('VF_MANUAL_FIELD_UNKNOWN', `Unsupported manual field: ${key}`);
  }

  const invoiceType = normalizeInvoiceType(input.invoiceType);
  const series = text(input.series, 'series', { required: false, max: 40 });
  const number = text(input.number, 'number', { max: 60 });
  const issueDate = normalizeDate(input.issueDate);
  const issuer = party(input.issuer, 'issuer');
  const recipient = party(
    input.recipient,
    'recipient',
    { required: invoiceType !== 'F2' },
  );
  const tax = normalizeTax(input.tax);
  const rectification = normalizeRectification(input.rectification, invoiceType);

  const sourceInvoiceId = `manual:${issueDate}:${series}:${number}`;
  const intent = {
    sourceInvoiceId,
    series,
    number,
    issueDate,
    invoiceType,
    description: text(input.description, 'description', { max: 500 }),
    issuer,
    ...(recipient ? { recipients: [recipient] } : {}),
    currency: 'EUR',
    taxBreakdown: [{
      taxCode: '01',
      regimeKey: '01',
      operationClass: 'S1',
      rate: tax.rate,
      baseAmount: tax.baseAmount,
      taxAmount: tax.taxAmount,
    }],
    adjustments: [],
    totals: {
      baseAmount: tax.baseAmount,
      taxAmount: tax.taxAmount,
      totalAmount: tax.totalAmount,
    },
    ...(rectification ? { rectification } : {}),
  };
  return Object.freeze(intent);
}

export function manualCaptureIdempotencyKey(input = {}) {
  const intent = manualCaptureToIntent(input);
  return `manual-issue:${intent.issueDate}:${intent.series}:${intent.number}`;
}
