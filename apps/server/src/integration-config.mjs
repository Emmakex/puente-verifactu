import { readFileSync } from 'node:fs';
import { validateMappingProfile } from '../../../packages/core/src/mapping.mjs';

export function validateIntegrationConfig(config = { integrations: [] }) {
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
  return Object.freeze({ integrations: Object.freeze(integrations) });
}

export function loadIntegrationConfig(path) {
  if (!path) return validateIntegrationConfig({ integrations: [] });
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
  return {
    async resolveMappingProfile({ context, profileId }) {
      return match(context, profileId)?.mappingProfile ?? null;
    },
    async resolveWebhookSecret({ context, profileId }) {
      return match(context, profileId)?.webhookSecret ?? null;
    },
  };
}
