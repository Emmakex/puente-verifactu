import { MAPPING_PROFILE_VERSION } from '../../contracts/src/constants.mjs';
import { MAPPING_ALIASES, getPath, normalizeMappingHeader, setPath } from './mapping.mjs';

export const MAPPING_TARGETS = Object.freeze(Object.keys(MAPPING_ALIASES));

export const ESSENTIAL_MAPPING_TARGETS = Object.freeze([
  'number',
  'issueDate',
  'invoiceType',
  'description',
  'taxBreakdown.0.baseAmount',
  'taxBreakdown.0.taxAmount',
  'totals.totalAmount',
]);

export const CONFIGURATION_TARGETS = Object.freeze([
  'issuer.name',
  'issuer.taxId',
  'currency',
  'taxBreakdown.0.taxCode',
  'taxBreakdown.0.regimeKey',
  'taxBreakdown.0.operationClass',
]);

function assistantError(code, message) {
  return Object.assign(new Error(message), { code });
}

function tokens(value) {
  return new Set(normalizeMappingHeader(value).split(' ').filter(Boolean));
}

function jaccard(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function headerScore(header, alias) {
  const normalizedHeader = normalizeMappingHeader(header);
  const normalizedAlias = normalizeMappingHeader(alias);
  if (!normalizedHeader || !normalizedAlias) return { score: 0, reason: 'none' };
  if (normalizedHeader === normalizedAlias) return { score: 1, reason: 'exact_alias' };
  if (Math.min(normalizedHeader.length, normalizedAlias.length) >= 4 && (normalizedHeader.includes(normalizedAlias) || normalizedAlias.includes(normalizedHeader))) {
    return { score: 0.9, reason: 'contained_alias' };
  }
  const similarity = jaccard(normalizedHeader, normalizedAlias);
  if (similarity >= 0.75) return { score: 0.86, reason: 'token_similarity' };
  if (similarity >= 0.5) return { score: 0.74, reason: 'token_similarity' };
  return { score: 0, reason: 'none' };
}

function sampleValues(sampleRows, header) {
  return sampleRows
    .slice(0, 25)
    .map((row) => row?.[header])
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function ratio(values, predicate) {
  if (!values.length) return 0;
  return values.filter(predicate).length / values.length;
}

function numericLike(value) {
  return /^-?[\d\s.]+(?:,\d+)?$|^-?\d+(?:\.\d+)?$/.test(String(value).trim());
}

function valueSignal(target, values) {
  if (!values.length) return { boost: 0, reason: null };
  if (target === 'issueDate' && ratio(values, (value) => /^\d{4}-\d{2}-\d{2}$|^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}$/.test(String(value).trim())) >= 0.7) {
    return { boost: 0.08, reason: 'date_values' };
  }
  if (target === 'invoiceType' && ratio(values, (value) => /^(?:F[123]|R[1-5])$/i.test(String(value).trim())) >= 0.7) {
    return { boost: 0.12, reason: 'invoice_type_values' };
  }
  if (target === 'recipients.0.taxId' && ratio(values, (value) => /^[A-Z0-9-]{7,20}$/i.test(String(value).trim())) >= 0.7) {
    return { boost: 0.05, reason: 'identifier_values' };
  }
  if ((target.includes('Amount') || target.endsWith('.rate') || target.endsWith('Rate')) && ratio(values, numericLike) >= 0.8) {
    return { boost: 0.06, reason: 'numeric_values' };
  }
  return { boost: 0, reason: null };
}

export function mappingTransformsForTarget(target) {
  if (!MAPPING_TARGETS.includes(target)) throw assistantError('VF_MAPPING_TARGET_UNKNOWN', `Unknown mapping target: ${target}`);
  const steps = ['trim'];
  if (target === 'issueDate') steps.push('date_dmy');
  if (target === 'invoiceType' || target.endsWith('.taxId')) steps.push('upper');
  if (target.includes('Amount') || target.endsWith('.rate') || target.endsWith('Rate')) steps.push('decimal_comma');
  return steps;
}

function bestCandidate(header, target, aliases, rows) {
  let best = { score: 0, reason: 'none', alias: null };
  for (const alias of aliases) {
    const scored = headerScore(header, alias);
    if (scored.score > best.score) best = { ...scored, alias };
  }
  if (!best.score) return null;
  const signal = valueSignal(target, sampleValues(rows, header));
  const score = Math.min(1, best.score + signal.boost);
  return {
    source: header,
    target,
    confidence: Number(score.toFixed(2)),
    status: score >= 0.92 ? 'auto' : score >= 0.72 ? 'review' : 'unmatched',
    reasons: [best.reason, signal.reason].filter(Boolean),
    matchedAlias: best.alias,
  };
}

export function suggestMapping(headers, { sampleRows = [], sourceType = 'file', locale = 'es-ES', constants = {} } = {}) {
  const candidates = [];
  for (const header of headers) {
    for (const [target, aliases] of Object.entries(MAPPING_ALIASES)) {
      const candidate = bestCandidate(header, target, aliases, sampleRows);
      if (candidate && candidate.status !== 'unmatched') candidates.push(candidate);
    }
  }

  candidates.sort((left, right) => right.confidence - left.confidence || left.source.localeCompare(right.source));
  const usedSources = new Set();
  const usedTargets = new Set();
  const suggestions = [];
  for (const candidate of candidates) {
    if (usedSources.has(candidate.source) || usedTargets.has(candidate.target)) continue;
    usedSources.add(candidate.source);
    usedTargets.add(candidate.target);
    suggestions.push(candidate);
  }

  const auto = suggestions.filter((suggestion) => suggestion.status === 'auto');
  const review = suggestions.filter((suggestion) => suggestion.status === 'review');
  const fields = Object.fromEntries(auto.map((suggestion) => [suggestion.source, suggestion.target]));
  const transforms = Object.fromEntries(auto.map((suggestion) => [suggestion.source, mappingTransformsForTarget(suggestion.target)]));
  const consideredTargets = new Set(suggestions.map((suggestion) => suggestion.target));
  const unmappedHeaders = headers.filter((header) => !usedSources.has(header));
  const missingEssentialTargets = ESSENTIAL_MAPPING_TARGETS.filter((target) => !consideredTargets.has(target) && getPath(constants, target) == null);
  const missingConfiguration = CONFIGURATION_TARGETS.filter((target) => getPath(constants, target) == null);

  return {
    assistantVersion: 1,
    safeToPreflight: review.length === 0 && missingEssentialTargets.length === 0 && missingConfiguration.length === 0,
    summary: {
      headers: headers.length,
      auto: auto.length,
      review: review.length,
      unmatched: unmappedHeaders.length,
      missingEssential: missingEssentialTargets.length,
      missingConfiguration: missingConfiguration.length,
    },
    suggestions,
    unmappedHeaders,
    missingEssentialTargets,
    missingConfiguration,
    profile: {
      profileVersion: MAPPING_PROFILE_VERSION,
      id: 'assistant-draft',
      name: 'Borrador asistido / Assisted draft',
      sourceType,
      locale,
      fields,
      transforms,
      constants: structuredClone(constants),
      defaults: {},
    },
  };
}

export function acceptMappingSuggestions(report, acceptedSources = []) {
  const accepted = new Set(acceptedSources);
  const profile = structuredClone(report.profile);
  for (const suggestion of report.suggestions ?? []) {
    if (suggestion.status !== 'review' || !accepted.has(suggestion.source)) continue;
    profile.fields[suggestion.source] = suggestion.target;
    profile.transforms[suggestion.source] = mappingTransformsForTarget(suggestion.target);
  }
  return profile;
}

export function buildMappingProfile(report, { acceptedSources = [], overrides = {}, constants = {} } = {}) {
  if (report?.assistantVersion !== 1) throw assistantError('VF_MAPPING_ASSISTANT_VERSION_INVALID', 'Mapping assistant report version must be 1');
  const profile = acceptMappingSuggestions(report, acceptedSources);
  const sources = new Set([
    ...Object.keys(report.profile?.fields ?? {}),
    ...(report.suggestions ?? []).map((item) => item.source),
    ...(report.unmappedHeaders ?? []),
  ]);

  for (const [source, target] of Object.entries(overrides ?? {})) {
    if (!sources.has(source)) throw assistantError('VF_MAPPING_SOURCE_UNKNOWN', `Unknown source column: ${source}`);
    if (target == null || target === '') {
      delete profile.fields[source];
      delete profile.transforms[source];
      continue;
    }
    if (!MAPPING_TARGETS.includes(target)) throw assistantError('VF_MAPPING_TARGET_UNKNOWN', `Unknown mapping target: ${target}`);
    const duplicateSource = Object.entries(profile.fields).find(([existingSource, existingTarget]) => existingSource !== source && existingTarget === target)?.[0];
    if (duplicateSource) throw assistantError('VF_MAPPING_TARGET_DUPLICATE', `Target ${target} is already mapped from ${duplicateSource}`);
    profile.fields[source] = target;
    profile.transforms[source] = mappingTransformsForTarget(target);
  }

  profile.constants = structuredClone(profile.constants ?? {});
  for (const [path, value] of Object.entries(constants ?? {})) {
    if (value !== undefined && value !== null && value !== '') setPath(profile.constants, path, value);
  }
  return profile;
}
