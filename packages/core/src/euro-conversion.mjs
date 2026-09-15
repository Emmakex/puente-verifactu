import { isAmount, sumAmounts, toCents } from './decimal.mjs';
import { validateInvoiceIntent } from './validation.mjs';

const RATE_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function conversionError(code, message, details = []) {
  return Object.assign(new Error(message), { code, details });
}

function normalizeRate(value) {
  const text = String(value ?? '').trim();
  if (!RATE_RE.test(text) || /^0(?:\.0+)?$/.test(text)) {
    throw conversionError('VF_FX_RATE_INVALID', 'EUR conversion rate must be a positive exact decimal');
  }
  return text;
}

function multiplyAmountByRate(amount, rate) {
  if (!isAmount(amount)) throw conversionError('VF_FX_AMOUNT_INVALID', `Invalid source amount: ${String(amount)}`);
  const sourceCents = toCents(amount);
  const negative = sourceCents < 0n;
  const absoluteCents = negative ? -sourceCents : sourceCents;
  const [whole, fraction = ''] = rate.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const rateUnits = BigInt(whole) * scale + BigInt(fraction || '0');
  const numerator = absoluteCents * rateUnits;
  const quotient = numerator / scale;
  const remainder = numerator % scale;
  const rounded = remainder * 2n >= scale ? quotient + 1n : quotient;
  const signed = negative ? -rounded : rounded;
  const units = signed < 0n ? -signed : signed;
  const sign = signed < 0n ? '-' : '';
  return `${sign}${units / 100n}.${String(units % 100n).padStart(2, '0')}`;
}

function assertConversion(intent, conversion) {
  if (!conversion || typeof conversion !== 'object') {
    throw conversionError('VF_FX_CONVERSION_REQUIRED', 'Non-EUR invoice requires a server-side EUR conversion');
  }
  if (conversion.schemaVersion !== 1) throw conversionError('VF_FX_SCHEMA_VERSION', 'EUR conversion schemaVersion must be 1');
  if (conversion.sourceCurrency !== intent.currency) throw conversionError('VF_FX_SOURCE_CURRENCY_MISMATCH', 'EUR conversion source currency does not match InvoiceIntent');
  if (conversion.targetCurrency !== 'EUR') throw conversionError('VF_FX_TARGET_CURRENCY_INVALID', 'EUR conversion targetCurrency must be EUR');
  if (!DATE_RE.test(String(conversion.rateDate ?? ''))) throw conversionError('VF_FX_RATE_DATE_INVALID', 'EUR conversion rateDate must use YYYY-MM-DD');
  if (!String(conversion.rateSource ?? '').trim()) throw conversionError('VF_FX_RATE_SOURCE_REQUIRED', 'EUR conversion rateSource is required');
  if (!String(conversion.reference ?? '').trim()) throw conversionError('VF_FX_RATE_REFERENCE_REQUIRED', 'EUR conversion reference is required');
  return normalizeRate(conversion.eurPerUnit);
}

function convertLine(line, rate) {
  const result = {
    ...line,
    baseAmount: multiplyAmountByRate(line.baseAmount, rate),
    taxAmount: multiplyAmountByRate(line.taxAmount, rate),
  };
  if (line.surchargeAmount !== undefined) result.surchargeAmount = multiplyAmountByRate(line.surchargeAmount, rate);
  return result;
}

function applyExplicitFiscalAmounts(fiscalIntent, fiscalAmounts) {
  if (!fiscalAmounts) return;
  if (!Array.isArray(fiscalAmounts.taxBreakdown) || fiscalAmounts.taxBreakdown.length !== fiscalIntent.taxBreakdown.length) {
    throw conversionError('VF_FX_EXPLICIT_BREAKDOWN_INVALID', 'Explicit EUR tax breakdown must match the source line count');
  }
  fiscalIntent.taxBreakdown = fiscalIntent.taxBreakdown.map((line, index) => ({
    ...line,
    baseAmount: fiscalAmounts.taxBreakdown[index].baseAmount,
    taxAmount: fiscalAmounts.taxBreakdown[index].taxAmount,
    ...(line.surchargeAmount !== undefined ? { surchargeAmount: fiscalAmounts.taxBreakdown[index].surchargeAmount } : {}),
  }));
  if (!fiscalAmounts.totals) throw conversionError('VF_FX_EXPLICIT_TOTALS_REQUIRED', 'Explicit EUR totals are required with explicit fiscal amounts');
  fiscalIntent.totals = structuredClone(fiscalAmounts.totals);
  if (Array.isArray(fiscalIntent.adjustments) && fiscalIntent.adjustments.length > 0) {
    if (!Array.isArray(fiscalAmounts.adjustments) || fiscalAmounts.adjustments.length !== fiscalIntent.adjustments.length) {
      throw conversionError('VF_FX_EXPLICIT_ADJUSTMENTS_INVALID', 'Explicit EUR adjustments must match the source adjustment count');
    }
    fiscalIntent.adjustments = fiscalIntent.adjustments.map((item, index) => ({ ...item, amount: fiscalAmounts.adjustments[index].amount }));
  }
  if (fiscalIntent.rectification?.type === 'S') {
    const explicit = fiscalAmounts.rectification;
    if (!explicit) throw conversionError('VF_FX_EXPLICIT_RECTIFICATION_REQUIRED', 'Explicit EUR rectification amounts are required');
    for (const field of ['correctedBaseAmount', 'correctedTaxAmount', 'correctedSurchargeAmount']) {
      if (fiscalIntent.rectification[field] !== undefined) fiscalIntent.rectification[field] = explicit[field];
    }
  }
}

export function convertInvoiceIntentToEuro(intent, conversion) {
  if (intent?.currency === 'EUR') {
    return {
      fiscalIntent: structuredClone(intent),
      conversion: null,
    };
  }

  const structural = validateInvoiceIntent(intent, { allowNonEuro: true });
  if (!structural.ok) throw conversionError('VF_FX_SOURCE_INTENT_INVALID', 'Source InvoiceIntent is invalid before EUR conversion', structural.errors);
  const rate = assertConversion(intent, conversion);
  const fiscalIntent = structuredClone(intent);
  fiscalIntent.currency = 'EUR';
  fiscalIntent.taxBreakdown = intent.taxBreakdown.map((line) => convertLine(line, rate));
  fiscalIntent.adjustments = (intent.adjustments ?? []).map((item) => ({ ...item, amount: multiplyAmountByRate(item.amount, rate) }));
  fiscalIntent.totals = {
    baseAmount: multiplyAmountByRate(intent.totals.baseAmount, rate),
    taxAmount: multiplyAmountByRate(intent.totals.taxAmount, rate),
    totalAmount: multiplyAmountByRate(intent.totals.totalAmount, rate),
  };
  if (intent.rectification?.type === 'S') {
    fiscalIntent.rectification = { ...intent.rectification };
    for (const field of ['correctedBaseAmount', 'correctedTaxAmount', 'correctedSurchargeAmount']) {
      if (intent.rectification[field] !== undefined) fiscalIntent.rectification[field] = multiplyAmountByRate(intent.rectification[field], rate);
    }
  }

  applyExplicitFiscalAmounts(fiscalIntent, conversion.fiscalAmounts);

  const validation = validateInvoiceIntent(fiscalIntent);
  if (!validation.ok) {
    const mismatch = validation.errors.some((item) => item.code?.includes('MISMATCH'));
    throw conversionError(
      mismatch ? 'VF_FX_ROUNDING_RECONCILIATION_REQUIRED' : 'VF_FX_FISCAL_INTENT_INVALID',
      mismatch
        ? 'Converted EUR amounts do not reconcile after cent rounding; provide explicit audited fiscalAmounts'
        : 'Converted EUR fiscal intent is invalid',
      validation.errors,
    );
  }

  const audit = Object.freeze({
    schemaVersion: 1,
    sourceCurrency: intent.currency,
    targetCurrency: 'EUR',
    eurPerUnit: rate,
    rateDate: conversion.rateDate,
    rateSource: String(conversion.rateSource).trim(),
    reference: String(conversion.reference).trim(),
    method: conversion.fiscalAmounts ? 'explicit-amounts' : 'rate',
    sourceTotal: intent.totals.totalAmount,
    fiscalTotal: fiscalIntent.totals.totalAmount,
  });

  return { fiscalIntent, conversion: audit };
}

export function summarizeConvertedFiscalAmounts(intent) {
  return {
    baseAmount: sumAmounts(intent.taxBreakdown.map((line) => line.baseAmount)),
    taxAmount: sumAmounts(intent.taxBreakdown.map((line) => line.taxAmount)),
    totalAmount: intent.totals.totalAmount,
  };
}
