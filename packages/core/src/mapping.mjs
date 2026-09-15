import { MAPPING_PROFILE_VERSION } from '../../contracts/src/constants.mjs';
import { isAmount, sumAmounts } from './decimal.mjs';

export const MAPPING_ALIASES = Object.freeze({
  number: ['factura', 'numero factura', 'num factura', 'n factura', 'nº factura', 'n° factura', 'invoice number', 'invoice no', 'number'],
  series: ['serie', 'series'],
  issueDate: ['fecha', 'fecha factura', 'fecha expedicion', 'invoice date', 'issue date'],
  invoiceType: ['tipo factura', 'tipo', 'invoice type'],
  description: ['descripcion', 'concepto', 'description'],
  currency: ['moneda', 'currency', 'currency code'],
  'recipients.0.taxId': ['nif cliente', 'cif cliente', 'nif destinatario', 'customer tax id', 'vat number'],
  'recipients.0.name': ['cliente', 'nombre cliente', 'razon social cliente', 'destinatario', 'customer'],
  'taxBreakdown.0.baseAmount': ['base imponible', 'base', 'tax base', 'net amount'],
  'taxBreakdown.0.rate': ['iva %', 'tipo iva', 'porcentaje iva', 'vat %', 'tax rate'],
  'taxBreakdown.0.taxAmount': ['cuota iva', 'iva', 'vat amount', 'tax amount'],
  'taxBreakdown.0.surchargeRate': ['recargo equivalencia %', 'tipo recargo equivalencia', 'recargo %', 'surcharge rate'],
  'taxBreakdown.0.surchargeAmount': ['cuota recargo equivalencia', 'recargo equivalencia', 'importe recargo', 'surcharge amount'],
  'totals.totalAmount': ['total', 'importe total', 'total factura', 'invoice total'],
  'rectification.originalInvoices.0.number': ['factura rectificada', 'numero factura original', 'original invoice number'],
  'rectification.originalInvoices.0.series': ['serie factura original', 'original invoice series'],
  'rectification.originalInvoices.0.issueDate': ['fecha factura original', 'original invoice date'],
  sourceInvoiceId: ['id factura', 'invoice id', 'external id'],
});

const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
const MAPPING_TARGET_SET = new Set([...Object.keys(MAPPING_ALIASES), 'taxBreakdown']);
const TAX_LINE_SOURCE_FIELDS = new Set(['rate', 'baseAmount', 'taxAmount', 'surchargeRate', 'surchargeAmount']);
const TAX_LINE_DEFAULT_FIELDS = new Set(['taxCode', 'regimeKey', 'operationClass']);
const NATIVE_FORBIDDEN_SOURCE_TARGETS = new Set(['invoiceType']);

export function normalizeMappingHeader(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[º°#._-]+/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pathParts(path) {
  const raw = String(path ?? '');
  if (!raw || raw.length > 256) throw new Error('Mapping path is empty or too long');
  const parts = raw.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  if (parts.some((part) => typeof part === 'string' && FORBIDDEN_PATH_PARTS.has(part))) {
    throw new Error(`Unsafe mapping path: ${raw}`);
  }
  return parts;
}

export function setPath(target, path, value) {
  const parts = pathParts(path);
  let cursor = target;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const last = index === parts.length - 1;
    if (last) {
      cursor[part] = value;
      return target;
    }

    const next = parts[index + 1];
    if (cursor[part] === undefined) cursor[part] = typeof next === 'number' ? [] : {};
    if (!cursor[part] || typeof cursor[part] !== 'object') throw new Error(`Mapping path conflicts with scalar value: ${path}`);
    cursor = cursor[part];
  }

  return target;
}

export function getPath(target, path) {
  return pathParts(path).reduce((value, part) => value?.[part], target);
}

function transformValue(value, transform) {
  if (value === undefined || value === null) return value;
  const text = String(value);

  switch (transform) {
    case 'trim':
      return text.trim();
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'decimal_comma': {
      const compact = text.trim().replace(/\s/g, '');
      if (compact.includes(',')) return compact.replace(/\./g, '').replace(',', '.');
      return compact;
    }
    case 'date_dmy': {
      const match = text.trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
      if (!match) return text.trim();
      return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    }
    default:
      throw new Error(`Unsupported mapping transform: ${transform}`);
  }
}

function applyTransforms(value, transforms = []) {
  return transforms.reduce((current, transform) => transformValue(current, transform), value);
}

function mapNativeTaxLines(value, defaults) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    throw new Error('Native taxBreakdown source must contain between 1 and 12 lines');
  }
  const requiredDefaults = ['taxCode', 'regimeKey', 'operationClass'];
  if (!defaults || requiredDefaults.some((field) => !String(defaults[field] ?? '').trim())) {
    throw new Error('taxLineDefaults with taxCode, regimeKey and operationClass are required for native taxBreakdown mapping');
  }

  return value.map((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) throw new Error(`Invalid native tax line at index ${index}`);
    for (const field of Object.keys(line)) {
      if (!TAX_LINE_SOURCE_FIELDS.has(field)) throw new Error(`Unsupported native tax line field ${field}`);
    }
    const mapped = { ...defaults };
    for (const field of TAX_LINE_SOURCE_FIELDS) {
      if (line[field] !== undefined && line[field] !== null && line[field] !== '') mapped[field] = String(line[field]).trim();
    }
    return mapped;
  });
}

function deriveSafeTotals(result) {
  if (!Array.isArray(result.taxBreakdown) || result.taxBreakdown.length === 0) return;
  result.totals ??= {};

  if (result.totals.baseAmount === undefined && result.taxBreakdown.every((line) => isAmount(line?.baseAmount))) {
    result.totals.baseAmount = sumAmounts(result.taxBreakdown.map((line) => line.baseAmount));
  }
  if (result.totals.taxAmount === undefined && result.taxBreakdown.every((line) => isAmount(line?.taxAmount))) {
    result.totals.taxAmount = sumAmounts(result.taxBreakdown.map((line) => line.taxAmount));
  }
}

export function validateMappingProfile(profile) {
  const errors = [];
  if (profile?.profileVersion !== MAPPING_PROFILE_VERSION) errors.push('profileVersion must be 1');
  if (!profile?.id) errors.push('id is required');
  if (!profile?.name) errors.push('name is required');
  if (!profile?.sourceType) errors.push('sourceType is required');
  if (!profile?.fields || typeof profile.fields !== 'object' || Array.isArray(profile.fields)) errors.push('fields must be an object');

  let mapsNativeTaxLines = false;
  for (const [source, target] of Object.entries(profile?.fields ?? {})) {
    if (!MAPPING_TARGET_SET.has(target)) errors.push(`Unsupported mapping target ${target} for ${source}`);
    if (profile?.sourceType === 'native' && NATIVE_FORBIDDEN_SOURCE_TARGETS.has(target)) {
      errors.push(`Native source cannot control fiscal target ${target}; configure it server-side`);
    }
    if (target === 'taxBreakdown') mapsNativeTaxLines = true;
  }

  if (profile?.taxLineDefaults !== undefined) {
    if (!profile.taxLineDefaults || typeof profile.taxLineDefaults !== 'object' || Array.isArray(profile.taxLineDefaults)) {
      errors.push('taxLineDefaults must be an object');
    } else {
      for (const field of Object.keys(profile.taxLineDefaults)) if (!TAX_LINE_DEFAULT_FIELDS.has(field)) errors.push(`Unsupported taxLineDefaults field ${field}`);
    }
  }
  if (mapsNativeTaxLines && ['taxCode', 'regimeKey', 'operationClass'].some((field) => !String(profile?.taxLineDefaults?.[field] ?? '').trim())) {
    errors.push('taxLineDefaults.taxCode, regimeKey and operationClass are required when mapping taxBreakdown');
  }

  const allowedTransforms = new Set(['trim', 'upper', 'lower', 'decimal_comma', 'date_dmy']);
  for (const [source, transforms] of Object.entries(profile?.transforms ?? {})) {
    if (!Array.isArray(transforms)) errors.push(`transforms.${source} must be an array`);
    else for (const transform of transforms) if (!allowedTransforms.has(transform)) errors.push(`Unsupported transform ${transform} for ${source}`);
  }

  for (const target of Object.keys(profile?.defaults ?? {})) {
    try { pathParts(target); } catch (error) { errors.push(error.message); }
  }

  return { ok: errors.length === 0, errors };
}

export function applyMapping(row, profile) {
  const profileValidation = validateMappingProfile(profile);
  if (!profileValidation.ok) throw new Error(`Invalid MappingProfile: ${profileValidation.errors.join('; ')}`);

  const result = structuredClone(profile.constants ?? {});

  for (const [source, target] of Object.entries(profile.fields)) {
    if (!(source in row)) continue;
    const rawValue = row[source];
    if (rawValue === '' || rawValue === undefined || rawValue === null) continue;
    if (target === 'taxBreakdown') {
      result.taxBreakdown = mapNativeTaxLines(rawValue, profile.taxLineDefaults);
      continue;
    }
    const value = applyTransforms(rawValue, profile.transforms?.[source]);
    setPath(result, target, value);
  }

  for (const [target, value] of Object.entries(profile.defaults ?? {})) {
    const current = getPath(result, target);
    if (current === undefined || current === null || current === '') setPath(result, target, value);
  }

  if (!result.sourceInvoiceId && result.number) {
    result.sourceInvoiceId = `${result.series ? `${result.series}:` : ''}${result.number}`;
    result.sourceMetadata = { ...(result.sourceMetadata ?? {}), sourceInvoiceIdDerived: true };
  }

  deriveSafeTotals(result);
  return result;
}

export function inferMapping(headers) {
  const normalizedHeaders = new Map(headers.map((header) => [normalizeMappingHeader(header), header]));
  const fields = {};
  const transforms = {};
  const matchedTargets = [];

  for (const [target, aliases] of Object.entries(MAPPING_ALIASES)) {
    const alias = aliases.find((candidate) => normalizedHeaders.has(normalizeMappingHeader(candidate)));
    if (!alias) continue;
    const source = normalizedHeaders.get(normalizeMappingHeader(alias));
    fields[source] = target;
    matchedTargets.push(target);

    const steps = ['trim'];
    if (target === 'issueDate' || target.endsWith('.issueDate')) steps.push('date_dmy');
    if (target === 'invoiceType' || target === 'currency') steps.push('upper');
    if (target.includes('Amount') || target.endsWith('.rate') || target.endsWith('Rate')) steps.push('decimal_comma');
    transforms[source] = steps;
  }

  const unmatchedHeaders = headers.filter((header) => !(header in fields));
  return {
    profile: {
      profileVersion: MAPPING_PROFILE_VERSION,
      id: 'inferred-profile',
      name: 'Perfil inferido / Inferred profile',
      sourceType: 'csv',
      locale: 'es-ES',
      fields,
      transforms,
      constants: {},
      defaults: {},
    },
    matchedTargets,
    unmatchedHeaders,
  };
}
