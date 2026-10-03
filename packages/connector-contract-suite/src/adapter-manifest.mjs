export const UNIVERSAL_ADAPTER_MANIFEST_VERSION = 1;

export const ADAPTER_CHANNELS = Object.freeze([
  'native',
  'api',
  'webhook',
  'file',
  'database',
  'folder',
  'sftp',
  'local_agent',
  'manual',
]);

export const ADAPTER_MODES = Object.freeze(['push', 'pull', 'hybrid', 'manual']);
export const ADAPTER_MAPPINGS = Object.freeze(['canonical', 'server-side']);
export const ADAPTER_TRANSPORTS = Object.freeze([
  'native-plugin',
  'https-json',
  'signed-webhook',
  'csv-xlsx',
  'database-read',
  'watch-folder',
  'sftp',
  'local-agent',
  'manual-form',
]);

const REQUIRED_CAPABILITIES = Object.freeze(['preflight', 'issue', 'status', 'sync']);
const OPTIONAL_CAPABILITIES = Object.freeze([
  'rectification',
  'presentation_return',
  'batch',
  'offline_queue',
  'source_read_only',
]);
const SECURITY_FLAGS = Object.freeze([
  'secrets_server_side',
  'aeat_certificate_server_side',
  'tenant_server_authoritative',
]);

function fail(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function text(value, name, pattern = /^[A-Za-z0-9._-]+$/) {
  const normalized = String(value ?? '').trim();
  if (!normalized || !pattern.test(normalized)) {
    throw fail('VF_ADAPTER_MANIFEST_INVALID', `${name} is invalid`, { field: name });
  }
  return normalized;
}

function enumValue(value, name, allowed) {
  const normalized = String(value ?? '').trim();
  if (!allowed.includes(normalized)) {
    throw fail('VF_ADAPTER_MANIFEST_INVALID', `${name} is not supported`, { field: name, allowed });
  }
  return normalized;
}

function booleanField(object, key, requiredValue = null) {
  if (typeof object?.[key] !== 'boolean') {
    throw fail('VF_ADAPTER_MANIFEST_INVALID', `${key} must be boolean`, { field: key });
  }
  if (requiredValue !== null && object[key] !== requiredValue) {
    throw fail('VF_ADAPTER_MANIFEST_SECURITY_INVARIANT', `${key} must be ${requiredValue}`, { field: key });
  }
  return object[key];
}

export function validateUniversalAdapterManifest(input) {
  if (input?.schema_version !== UNIVERSAL_ADAPTER_MANIFEST_VERSION
    || input?.kind !== 'puente-verifactu-adapter-manifest') {
    throw fail('VF_ADAPTER_MANIFEST_INVALID', 'Unsupported adapter manifest schema/kind');
  }

  const capabilities = {};
  for (const key of REQUIRED_CAPABILITIES) {
    capabilities[key] = booleanField(input.capabilities, key, true);
  }
  for (const key of OPTIONAL_CAPABILITIES) {
    capabilities[key] = booleanField(input.capabilities, key);
  }

  const security = {};
  for (const key of SECURITY_FLAGS) {
    security[key] = booleanField(input.security, key, true);
  }

  if (input.channel === 'database' && capabilities.source_read_only !== true) {
    throw fail('VF_ADAPTER_MANIFEST_DATABASE_NOT_READ_ONLY', 'Database adapters must be read-only by default');
  }
  if (input.channel === 'local_agent' && capabilities.offline_queue !== true) {
    throw fail('VF_ADAPTER_MANIFEST_OFFLINE_QUEUE_REQUIRED', 'Local-agent adapters must declare an offline queue');
  }

  return Object.freeze({
    schemaVersion: UNIVERSAL_ADAPTER_MANIFEST_VERSION,
    kind: input.kind,
    id: text(input.id, 'id'),
    channel: enumValue(input.channel, 'channel', ADAPTER_CHANNELS),
    transport: enumValue(input.transport, 'transport', ADAPTER_TRANSPORTS),
    mode: enumValue(input.mode, 'mode', ADAPTER_MODES),
    mapping: enumValue(input.mapping, 'mapping', ADAPTER_MAPPINGS),
    capabilities: Object.freeze(capabilities),
    security: Object.freeze(security),
  });
}

export function selectIntegrationRoute(capabilities = {}) {
  if (capabilities.nativeConnector === true) return 'native_plugin';
  if (capabilities.api === true) return 'rest_api';
  if (capabilities.webhook === true) return 'webhook';
  if (capabilities.databaseRead === true && capabilities.localAgentInstall === true) return 'database_read';
  if (capabilities.watchFolder === true && capabilities.localAgentInstall === true) return 'watch_folder';
  if (capabilities.sftp === true) return 'sftp';
  if (capabilities.fileExport === true) return 'file_upload';
  if (capabilities.localAgentInstall === true) return 'local_agent';
  return 'manual';
}
