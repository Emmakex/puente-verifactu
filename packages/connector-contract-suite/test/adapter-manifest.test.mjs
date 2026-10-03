import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectIntegrationRoute,
  validateUniversalAdapterManifest,
} from '../src/adapter-manifest.mjs';

function manifest(overrides = {}) {
  return {
    schema_version: 1,
    kind: 'puente-verifactu-adapter-manifest',
    id: 'reference-api',
    channel: 'api',
    transport: 'https-json',
    mode: 'push',
    mapping: 'server-side',
    capabilities: {
      preflight: true,
      issue: true,
      status: true,
      sync: true,
      rectification: true,
      presentation_return: true,
      batch: false,
      offline_queue: false,
      source_read_only: false,
    },
    security: {
      secrets_server_side: true,
      aeat_certificate_server_side: true,
      tenant_server_authoritative: true,
    },
    ...overrides,
  };
}

test('validates a neutral API adapter manifest', () => {
  const validated = validateUniversalAdapterManifest(manifest());
  assert.equal(validated.schemaVersion, 1);
  assert.equal(validated.channel, 'api');
  assert.equal(validated.capabilities.preflight, true);
  assert.equal(validated.security.tenant_server_authoritative, true);
});

test('rejects adapters that move fiscal authority or secrets to the source system', () => {
  assert.throws(
    () => validateUniversalAdapterManifest(manifest({
      security: {
        secrets_server_side: false,
        aeat_certificate_server_side: true,
        tenant_server_authoritative: true,
      },
    })),
    (error) => error.code === 'VF_ADAPTER_MANIFEST_SECURITY_INVARIANT',
  );
});

test('requires read-only source access for generic database adapters', () => {
  assert.throws(
    () => validateUniversalAdapterManifest(manifest({
      channel: 'database',
      transport: 'database-read',
      mode: 'pull',
      capabilities: {
        ...manifest().capabilities,
        source_read_only: false,
      },
    })),
    (error) => error.code === 'VF_ADAPTER_MANIFEST_DATABASE_NOT_READ_ONLY',
  );
});

test('requires offline queue for local-agent channel', () => {
  assert.throws(
    () => validateUniversalAdapterManifest(manifest({
      channel: 'local_agent',
      transport: 'local-agent',
      mode: 'hybrid',
      capabilities: {
        ...manifest().capabilities,
        offline_queue: false,
      },
    })),
    (error) => error.code === 'VF_ADAPTER_MANIFEST_OFFLINE_QUEUE_REQUIRED',
  );
});

test('selects integration routes by capability instead of brand', () => {
  assert.equal(selectIntegrationRoute({ nativeConnector: true, api: true }), 'native_plugin');
  assert.equal(selectIntegrationRoute({ api: true, fileExport: true }), 'rest_api');
  assert.equal(selectIntegrationRoute({ webhook: true, fileExport: true }), 'webhook');
  assert.equal(selectIntegrationRoute({ databaseRead: true, localAgentInstall: true }), 'database_read');
  assert.equal(selectIntegrationRoute({ watchFolder: true, localAgentInstall: true }), 'watch_folder');
  assert.equal(selectIntegrationRoute({ sftp: true }), 'sftp');
  assert.equal(selectIntegrationRoute({ fileExport: true }), 'file_upload');
  assert.equal(selectIntegrationRoute({ localAgentInstall: true }), 'local_agent');
  assert.equal(selectIntegrationRoute({}), 'manual');
});
