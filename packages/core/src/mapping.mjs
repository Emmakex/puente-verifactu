import { MAPPING_PROFILE_VERSION } from '../../contracts/src/constants.mjs';
import { isAmount, sumAmounts } from './decimal.mjs';

const ALIASES = Object.freeze({
  number: ['factura', 'numero factura', 'num factura', 'n factura', 'invoice number', 'invoice no', 'number'],
  series: ['serie', 'series'],
  issueDate: ['fecha', 'fecha factura', 'fecha expedicion', 'invoice date', 'issue date'],
  invoiceType: ['tipo factura', 'tipo', 'invoice type'],
  description: ['descripcion', 'concepto', 'description'],
  'recipients.0.taxId': ['nif cliente', 'cif cliente', 'nif destinatario', 'customer tax id', 'vat number'],
  'recipients.0.name': ['cliente', 'nombre cliente', 'razon social cliente', 'destinatario', 'customer'],
  'taxBreakdown.0.baseAmount': ['base imponible', 'base', 'tax base', 'net amount'],
  'taxBreakdown.0.rate': ['iva %', 'tipo iva', 'porcentaje iva', 'vat %', 'tax rate'],
  'taxBreakdown.0.taxAmount': ['cuota iva', 'iva', 'vat amount', 'tax amount'],
  'taxBreakdown.0.surchargeRate': ['recargo equivalencia %', 'tipo recargo equivalencia', 'recargo %', 'surcharge rate'],
  'taxBreakdown.0.surchargeAmount': ['cuota recargo equivalencia', 'recargo equivalencia', 'importe recargo', 'surcharge amount'],
  'totals.totalAmount': ['total', 'importe total', 'total factura', 'invoice total'],
  sourceInvoiceId: ['id factura', 'invoice id', 'external id'],
});

function normalizeHeader(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[º°#._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pathParts(path) {
  return path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
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
    if (cursor[part] === undefined) {
      cursor[part] = typeof next === 'number' ? [] : {};
    }
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

  const allowedTransforms = new Set(['trim', 'upper', 'lower', 'decimal_comma', 'date_dmy']);
  for (const [source, transforms] of Object.entries(profile?.transforms ?? {})) {
    if (!Array.isArray(transforms)) errors.push(`transforms.${source} must be an array`);
    else for (const transform of transforms) if (!allowedTransforms.has(transform)) errors.push(`Unsupported transform ${transform} for ${source}`);
  }

  return { ok: errors.length === 0, errors };
}

export function applyMapping(row, profile) {
  const profileValidation = validateMappingProfile(profile);
  if (!profileValidation.ok) {
    throw new Error(`Invalid MappingProfile: ${profileValidation.errors.join('; ')}`);
  }

  const result = structuredClone(profile.constants ?? {});

  for (const [source, target] of Object.entries(profile.fields)) {
    if (!(source in row)) continue;
    const rawValue = row[source];
    if (rawValue === '' || rawValue === undefined || rawValue === null) continue;
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
  const normalizedHeaders = new Map(headers.map((header) => [normalizeHeader(header), header]));
  const fields = {};
  const transforms = {};
  const matchedTargets = [];

  for (const [target, aliases] of Object.entries(ALIASES)) {
    const alias = aliases.find((candidate) => normalizedHeaders.has(normalizeHeader(candidate)));
    if (!alias) continue;
    const source = normalizedHeaders.get(normalizeHeader(alias));
    fields[source] = target;
    matchedTargets.push(target);

    const steps = ['trim'];
    if (target === 'issueDate') steps.push('date_dmy');
    if (target === 'invoiceType') steps.push('upper');
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
