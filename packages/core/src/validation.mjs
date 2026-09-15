import {
  ADJUSTMENT_TYPES,
  INVOICE_INTENT_VERSION,
  INVOICE_TYPES,
  RECTIFICATION_TYPES,
} from '../../contracts/src/constants.mjs';
import { isAmount, sumAmounts, toCents } from './decimal.mjs';

function issue(code, path, es, en, severity = 'error') {
  return { code, path, severity, message: { es, en } };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateParty(party, path, errors, { requireId = true } = {}) {
  if (!party || typeof party !== 'object') {
    errors.push(issue('VF_VALIDATION_PARTY_REQUIRED', path, 'Faltan los datos de identificación.', 'Identification data is missing.'));
    return;
  }
  if (!isNonEmptyString(party.name)) errors.push(issue('VF_VALIDATION_PARTY_NAME', `${path}.name`, 'Falta el nombre o razón social.', 'Name or legal name is missing.'));
  const hasTaxId = isNonEmptyString(party.taxId);
  const hasOtherId = party.otherId && isNonEmptyString(party.otherId.id) && isNonEmptyString(party.otherId.countryCode) && isNonEmptyString(party.otherId.idType);
  if (requireId && !hasTaxId && !hasOtherId) errors.push(issue('VF_VALIDATION_PARTY_ID', path, 'Falta el NIF o identificador extranjero.', 'Tax ID or foreign identifier is missing.'));
}

function validateAmounts(intent, errors) {
  for (const [index, line] of (intent.taxBreakdown ?? []).entries()) {
    for (const field of ['baseAmount', 'taxAmount']) {
      if (!isAmount(line?.[field])) errors.push(issue('VF_VALIDATION_AMOUNT', `taxBreakdown.${index}.${field}`, 'El importe debe usar formato decimal exacto, por ejemplo 100.00.', 'Amount must use exact decimal format, for example 100.00.'));
    }
    if (line?.rate !== undefined && !/^-?\d+(?:\.\d{1,4})?$/.test(line.rate)) errors.push(issue('VF_VALIDATION_RATE', `taxBreakdown.${index}.rate`, 'El tipo impositivo no tiene un formato válido.', 'Tax rate has an invalid format.'));
  }

  for (const field of ['baseAmount', 'taxAmount', 'totalAmount']) {
    if (!isAmount(intent.totals?.[field])) errors.push(issue('VF_VALIDATION_AMOUNT', `totals.${field}`, 'El total debe usar formato decimal exacto.', 'Total must use exact decimal format.'));
  }

  for (const [index, adjustment] of (intent.adjustments ?? []).entries()) {
    if (!ADJUSTMENT_TYPES.includes(adjustment?.type)) errors.push(issue('VF_VALIDATION_ADJUSTMENT_TYPE', `adjustments.${index}.type`, 'Tipo de ajuste no soportado.', 'Unsupported adjustment type.'));
    if (!isAmount(adjustment?.amount)) errors.push(issue('VF_VALIDATION_AMOUNT', `adjustments.${index}.amount`, 'El ajuste debe usar formato decimal exacto.', 'Adjustment must use exact decimal format.'));
  }
}

function validateTotals(intent, errors) {
  if (!Array.isArray(intent.taxBreakdown) || intent.taxBreakdown.length === 0) return;
  if (intent.taxBreakdown.some((line) => !isAmount(line.baseAmount) || !isAmount(line.taxAmount))) return;
  if (!isAmount(intent.totals?.baseAmount) || !isAmount(intent.totals?.taxAmount) || !isAmount(intent.totals?.totalAmount)) return;
  if ((intent.adjustments ?? []).some((adjustment) => !isAmount(adjustment.amount))) return;

  const base = sumAmounts(intent.taxBreakdown.map((line) => line.baseAmount));
  const tax = sumAmounts(intent.taxBreakdown.map((line) => line.taxAmount));
  if (toCents(base) !== toCents(intent.totals.baseAmount)) errors.push(issue('VF_VALIDATION_TOTAL_BASE_MISMATCH', 'totals.baseAmount', 'La suma de bases no coincide con el total de base.', 'Tax bases do not add up to the base total.'));
  if (toCents(tax) !== toCents(intent.totals.taxAmount)) errors.push(issue('VF_VALIDATION_TOTAL_TAX_MISMATCH', 'totals.taxAmount', 'La suma de cuotas no coincide con el total de impuestos.', 'Tax amounts do not add up to the tax total.'));

  const adjustments = (intent.adjustments ?? []).reduce((sum, item) => sum + toCents(item.amount), 0n);
  const expected = toCents(intent.totals.baseAmount) + toCents(intent.totals.taxAmount) + adjustments;
  if (expected !== toCents(intent.totals.totalAmount)) errors.push(issue('VF_VALIDATION_TOTAL_MISMATCH', 'totals.totalAmount', 'El total de factura no cuadra con base + impuestos + ajustes.', 'Invoice total does not equal base + tax + adjustments.'));
}

export function validateInvoiceIntent(intent) {
  const errors = [];
  const warnings = [];

  if (intent?.schemaVersion !== INVOICE_INTENT_VERSION) errors.push(issue('VF_VALIDATION_SCHEMA_VERSION', 'schemaVersion', 'La versión del contrato debe ser 1.', 'Contract version must be 1.'));
  if (intent?.operation !== 'issue') errors.push(issue('VF_VALIDATION_OPERATION', 'operation', 'La operación v1 soportada es issue.', 'The supported v1 operation is issue.'));

  for (const field of ['organizationId', 'installationId', 'sourceSystem', 'sourceInvoiceId', 'number', 'description']) {
    if (!isNonEmptyString(intent?.[field])) errors.push(issue('VF_VALIDATION_REQUIRED', field, `Falta el campo ${field}.`, `Field ${field} is required.`));
  }

  if (!validDate(intent?.issueDate)) errors.push(issue('VF_VALIDATION_DATE', 'issueDate', 'La fecha debe ser real y tener formato AAAA-MM-DD.', 'Date must be valid and use YYYY-MM-DD.'));
  if (!INVOICE_TYPES.includes(intent?.invoiceType)) errors.push(issue('VF_VALIDATION_INVOICE_TYPE', 'invoiceType', 'Tipo de factura no soportado por InvoiceIntent v1.', 'Invoice type is not supported by InvoiceIntent v1.'));

  validateParty(intent?.issuer, 'issuer', errors);

  if (intent?.invoiceType !== 'F2') {
    if (!Array.isArray(intent?.recipients) || intent.recipients.length === 0) errors.push(issue('VF_VALIDATION_RECIPIENT_REQUIRED', 'recipients', 'Este tipo de factura requiere destinatario identificado.', 'This invoice type requires an identified recipient.'));
  }
  for (const [index, recipient] of (intent?.recipients ?? []).entries()) validateParty(recipient, `recipients.${index}`, errors);

  if (!/^[A-Z]{3}$/.test(intent?.currency ?? '')) errors.push(issue('VF_VALIDATION_CURRENCY', 'currency', 'La moneda debe indicarse como código ISO de tres letras.', 'Currency must be a three-letter ISO code.'));
  else if (intent.currency !== 'EUR') warnings.push(issue('VF_WARNING_NON_EUR', 'currency', 'Moneda no EUR: el motor fiscal deberá aplicar la política de conversión correspondiente antes del envío.', 'Non-EUR currency: the fiscal engine must apply the relevant conversion policy before submission.', 'warning'));

  if (!Array.isArray(intent?.taxBreakdown) || intent.taxBreakdown.length === 0) errors.push(issue('VF_VALIDATION_TAX_BREAKDOWN', 'taxBreakdown', 'Debe existir al menos una línea de desglose fiscal.', 'At least one tax breakdown line is required.'));
  for (const [index, line] of (intent?.taxBreakdown ?? []).entries()) {
    for (const field of ['taxCode', 'regimeKey', 'operationClass']) {
      if (!isNonEmptyString(line?.[field])) errors.push(issue('VF_VALIDATION_TAX_CLASSIFICATION', `taxBreakdown.${index}.${field}`, 'Falta la clasificación fiscal de la línea.', 'Tax classification is missing.'));
    }
  }

  const rectifying = /^R[1-5]$/.test(intent?.invoiceType ?? '');
  if (rectifying && !RECTIFICATION_TYPES.includes(intent?.rectification?.type)) errors.push(issue('VF_VALIDATION_RECTIFICATION_TYPE', 'rectification.type', 'Una factura rectificativa debe indicar S (sustitución) o I (diferencias).', 'A corrective invoice must specify S (substitution) or I (differences).'));
  if (!rectifying && intent?.rectification) warnings.push(issue('VF_WARNING_UNUSED_RECTIFICATION', 'rectification', 'Se ignorarán datos de rectificación en un tipo de factura no rectificativo.', 'Rectification data will be ignored for a non-corrective invoice type.', 'warning'));

  validateAmounts(intent, errors);
  validateTotals(intent, errors);

  return { ok: errors.length === 0, errors, warnings };
}
