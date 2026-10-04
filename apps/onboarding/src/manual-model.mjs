export const MANUAL_COPY = Object.freeze({
  es: Object.freeze({
    title: 'Captura manual de factura',
    subtitle: 'Para autónomos y pequeñas empresas sin integración. Validamos primero y solo emitimos cuando confirmas.',
    back: 'Volver a conexiones',
    invoice: 'Factura',
    business: 'Emisor',
    customer: 'Cliente',
    tax: 'Importes e IVA',
    rectification: 'Rectificación',
    series: 'Serie',
    number: 'Número',
    issueDate: 'Fecha de expedición',
    invoiceType: 'Tipo de factura',
    description: 'Concepto',
    issuerName: 'Nombre o razón social',
    issuerTaxId: 'NIF/CIF',
    recipientName: 'Nombre / razón social del cliente',
    recipientTaxId: 'NIF/CIF del cliente',
    recipientHelp: 'Obligatorio para F1 y rectificativas. Opcional para F2.',
    baseAmount: 'Base imponible',
    rate: 'IVA',
    taxAmount: 'Cuota IVA',
    totalAmount: 'Total',
    calculate: 'Calcular IVA y total',
    rectificationType: 'Método de rectificación',
    correctedBaseAmount: 'Base rectificada',
    correctedTaxAmount: 'Cuota rectificada',
    validate: 'Validar sin emitir',
    confirm: 'He revisado los datos y confirmo la emisión fiscal.',
    issue: 'Emitir factura',
    refresh: 'Actualizar estado',
    validationOk: 'Preflight correcto. Revisa los datos y confirma antes de emitir.',
    validationError: 'Hay datos que corregir antes de emitir.',
    issued: 'Registro fiscal creado.',
    duplicate: 'La misma factura ya estaba registrada. Se muestra el registro existente.',
    qr: 'Verificación QR AEAT',
    standardProfile: 'Captura manual v1: operaciones interiores sujetas a IVA estándar 21 %, 10 % o 4 %. Otros regímenes deben usar una integración configurada.',
  }),
  en: Object.freeze({
    title: 'Manual invoice capture',
    subtitle: 'For small businesses without an integration. We validate first and issue only after explicit confirmation.',
    back: 'Back to connections',
    invoice: 'Invoice',
    business: 'Issuer',
    customer: 'Customer',
    tax: 'Amounts and VAT',
    rectification: 'Rectification',
    series: 'Series',
    number: 'Number',
    issueDate: 'Issue date',
    invoiceType: 'Invoice type',
    description: 'Description',
    issuerName: 'Business / legal name',
    issuerTaxId: 'Tax ID',
    recipientName: 'Customer name / legal name',
    recipientTaxId: 'Customer tax ID',
    recipientHelp: 'Required for F1 and corrective invoices. Optional for F2.',
    baseAmount: 'Tax base',
    rate: 'VAT',
    taxAmount: 'VAT amount',
    totalAmount: 'Total',
    calculate: 'Calculate VAT and total',
    rectificationType: 'Rectification method',
    correctedBaseAmount: 'Corrected base',
    correctedTaxAmount: 'Corrected tax',
    validate: 'Validate without issuing',
    confirm: 'I reviewed the data and confirm fiscal issuance.',
    issue: 'Issue invoice',
    refresh: 'Refresh status',
    validationOk: 'Preflight passed. Review the data and confirm before issuing.',
    validationError: 'Some data must be corrected before issuing.',
    issued: 'Fiscal record created.',
    duplicate: 'The same invoice was already registered. The existing record is shown.',
    qr: 'AEAT QR verification',
    standardProfile: 'Manual capture v1: domestic transactions subject to standard VAT at 21%, 10% or 4%. Other regimes require a configured integration.',
  }),
});

export const MANUAL_INVOICE_TYPES = Object.freeze([
  Object.freeze({ value: 'F2', label: { es: 'F2 · Factura simplificada', en: 'F2 · Simplified invoice' } }),
  Object.freeze({ value: 'F1', label: { es: 'F1 · Factura completa', en: 'F1 · Full invoice' } }),
  Object.freeze({ value: 'R1', label: { es: 'R1 · Rectificativa', en: 'R1 · Corrective invoice' } }),
  Object.freeze({ value: 'R2', label: { es: 'R2 · Rectificativa', en: 'R2 · Corrective invoice' } }),
  Object.freeze({ value: 'R3', label: { es: 'R3 · Rectificativa', en: 'R3 · Corrective invoice' } }),
  Object.freeze({ value: 'R4', label: { es: 'R4 · Rectificativa', en: 'R4 · Corrective invoice' } }),
  Object.freeze({ value: 'R5', label: { es: 'R5 · Rectificativa', en: 'R5 · Corrective invoice' } }),
]);

function parseCents(value) {
  const match = String(value ?? '').trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new TypeError('Amount must be a decimal with up to two decimals');
  const sign = match[1] === '-' ? -1n : 1n;
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return sign * cents;
}

function centsText(cents) {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function roundDiv(numerator, denominator) {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

export function calculateManualVat(baseAmount, rate) {
  const baseCents = parseCents(baseAmount);
  const rateValue = BigInt(String(rate ?? '').trim());
  if (![21n, 10n, 4n].includes(rateValue)) throw new TypeError('Unsupported manual VAT rate');
  const taxCents = roundDiv(baseCents * rateValue, 100n);
  return Object.freeze({
    taxAmount: centsText(taxCents),
    totalAmount: centsText(baseCents + taxCents),
  });
}

export function isRectifyingInvoiceType(invoiceType) {
  return /^R[1-5]$/.test(String(invoiceType ?? ''));
}

export function manualPayload(values = {}) {
  const invoiceType = String(values.invoiceType ?? 'F2');
  const payload = {
    series: String(values.series ?? '').trim(),
    number: String(values.number ?? '').trim(),
    issueDate: String(values.issueDate ?? '').trim(),
    invoiceType,
    description: String(values.description ?? '').trim(),
    issuer: {
      name: String(values.issuerName ?? '').trim(),
      taxId: String(values.issuerTaxId ?? '').trim(),
    },
    tax: {
      rate: String(values.rate ?? '').trim(),
      baseAmount: String(values.baseAmount ?? '').trim(),
      taxAmount: String(values.taxAmount ?? '').trim(),
      totalAmount: String(values.totalAmount ?? '').trim(),
    },
  };
  const recipientName = String(values.recipientName ?? '').trim();
  const recipientTaxId = String(values.recipientTaxId ?? '').trim();
  if (recipientName || recipientTaxId || invoiceType !== 'F2') {
    payload.recipient = { name: recipientName, taxId: recipientTaxId };
  }
  if (isRectifyingInvoiceType(invoiceType)) {
    payload.rectification = {
      type: String(values.rectificationType ?? '').trim(),
      ...(String(values.rectificationType ?? '').trim() === 'S'
        ? {
            correctedBaseAmount: String(values.correctedBaseAmount ?? '').trim(),
            correctedTaxAmount: String(values.correctedTaxAmount ?? '').trim(),
          }
        : {}),
    };
  }
  return payload;
}
