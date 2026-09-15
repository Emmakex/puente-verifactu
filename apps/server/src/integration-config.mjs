import { readFileSync } from 'node:fs';
import { validateMappingProfile } from '../../../packages/core/src/mapping.mjs';

const FX_RATE_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requiredText(value, path) {
  if (!value || typeof value !== 'string' || !value.trim()) throw new TypeError(`${path} is required`);
  return value.trim();
}

function validateEuroConversions(input = []) {
  if (!Array.isArray(input)) throw new TypeError('integration config euroConversions must be an array');
  const seen = new Set();
  return input.map((entry, index) => {
    const prefix = `euroConversions[${index}]`;
    const organizationId = requiredText(entry?.organizationId, `${prefix}.organizationId`);
    const installationId = requiredText(entry?.installationId, `${prefix}.installationId`);
    const sourceCurrency = requiredText(entry?.sourceCurrency, `${prefix}.sourceCurrency`).toUpperCase();
    if (!/^[A-Z]{3}$/.test(sourceCurrency) || sourceCurrency === 'EUR') throw new TypeError(`${prefix}.sourceCurrency must be a non-EUR ISO currency code`);
    const rateDate = requiredText(entry?.rateDate, `${prefix}.rateDate`);
    if (!DATE_RE.test(rateDate)) throw new TypeError(`${prefix}.rateDate must use YYYY-MM-DD`);
    const eurPerUnit = String(entry?.eurPerUnit ?? '').trim();
    if (!FX_RATE_RE.test(eurPerUnit) || /^0(?:\.0+)?$/.test(eurPerUnit)) throw new TypeError(`${prefix}.eurPerUnit must be a positive exact decimal`);
    const rateSource = requiredText(entry?.rateSource, `${prefix}.rateSource`);
    const reference = requiredText(entry?.reference, `${prefix}.reference`);
    const sourceInvoiceId = entry?.sourceInvoiceId == null ? null : requiredText(entry.sourceInvoiceId, `${prefix}.sourceInvoiceId`);
    const key = [organizationId, installationId, sourceCurrency, rateDate, sourceInvoiceId ?? '*'].join('\u001f');
    if (seen.has(key)) throw new TypeError(`duplicate EUR conversion: ${key}`);
    seen.add(key);
    return Object.freeze({
      schemaVersion: 1,
      organizationId,
      installationId,
      sourceCurrency,
      targetCurrency: 'EUR',
      eurPerUnit,
      rateDate,
      rateSource,
      reference,
      sourceInvoiceId,
      fiscalAmounts: entry?.fiscalAmounts == null ? undefined : Object.freeze(structuredClone(entry.fiscalAmounts)),
    });
  });
}

export function validateIntegrationConfig(config = { integrations: [], euroConversions: [] }) {
  if (!Array.isArray(config?.integrations)) throw new TypeError('integration config must contain integrations array');
  const seen = new Set();
  const integrations = config.integrations.map((entry, index) => {
    const prefix = `integrations[${index}]`;
    for (const field of ['id', 'organizationId', 'installationId']) {
      if (!entry?.[field] || typeof entry[field] !== 'string') throw new TypeError(`${prefix}.${field} is required`);
    }
    if (!entry.mappingProfile || typeof entry.mappingProfile !== 'object') throw new TypeError(`${prefix}.mappingProfile is required`);
    const validation = validateMappingProfile(entry.mappingProfile);
    if (!validation.ok) throw new TypeError(`${prefix}.mappingProfile invalid: ${validation.errors.join('; ')}`);
    if (entry.mappingProfile.id !== entry.id) throw new TypeError(`${prefix}.mappingProfile.id must equal integration id`);
    if (entry.webhookSecret !== undefined && (typeof entry.webhookSecret !== 'string' || entry.webhookSecret.length < 32)) {
      throw new TypeError(`${prefix}.webhookSecret must contain at least 32 characters when configured`);
    }
    const key = `${entry.organizationId}\u001f${entry.installationId}\u001f${entry.id}`;
    if (seen.has(key)) throw new TypeError(`duplicate integration: ${entry.id}`);
    seen.add(key);
    return Object.freeze({
      id: entry.id,
      organizationId: entry.organizationId,
      installationId: entry.installationId,
      mappingProfile: Object.freeze(structuredClone(entry.mappingProfile)),
      webhookSecret: entry.webhookSecret,
    });
  });
  const euroConversions = validateEuroConversions(config?.euroConversions ?? []);
  return Object.freeze({
    integrations: Object.freeze(integrations),
    euroConversions: Object.freeze(euroConversions),
  });
}

export function loadIntegrationConfig(path) {
  if (!path) return validateIntegrationConfig({ integrations: [], euroConversions: [] });
  return validateIntegrationConfig(JSON.parse(readFileSync(path, 'utf8')));
}

export function createIntegrationResolvers(configInput) {
  const config = validateIntegrationConfig(configInput);
  function match(context, profileId) {
    return config.integrations.find((entry) => (
      entry.id === profileId
      && entry.organizationId === context?.organizationId
      && entry.installationId === context?.installationId
    )) ?? null;
  }
  function matchingConversions(context, intent) {
    return config.euroConversions.filter((entry) => (
      entry.organizationId === context?.organizationId
      && entry.installationId === context?.installationId
      && entry.sourceCurrency === intent?.currency
      && entry.rateDate === intent?.issueDate
    ));
  }
  return {
    async resolveMappingProfile({ context, profileId }) {
      return match(context, profileId)?.mappingProfile ?? null;
    },
    async resolveWebhookSecret({ context, profileId }) {
      return match(context, profileId)?.webhookSecret ?? null;
    },
    resolveEuroConversion({ context, intent }) {
      const candidates = matchingConversions(context, intent);
      const invoiceSpecific = candidates.find((entry) => entry.sourceInvoiceId === intent?.sourceInvoiceId);
      const generic = candidates.find((entry) => entry.sourceInvoiceId == null);
      const selected = invoiceSpecific ?? generic ?? null;
      if (!selected) return null;
      return {
        schemaVersion: selected.schemaVersion,
        sourceCurrency: selected.sourceCurrency,
        targetCurrency: selected.targetCurrency,
        eurPerUnit: selected.eurPerUnit,
        rateDate: selected.rateDate,
        rateSource: selected.rateSource,
        reference: selected.reference,
        ...(selected.fiscalAmounts ? { fiscalAmounts: structuredClone(selected.fiscalAmounts) } : {}),
      };
    },
  };
}
