import { readFileSync } from 'node:fs';
import { validateUniversalAdapterManifest } from '../../packages/connector-contract-suite/src/adapter-manifest.mjs';

const manifest = validateUniversalAdapterManifest(
  JSON.parse(readFileSync('packages/local-agent/adapter-manifest.json', 'utf8')),
);

const failures = [];
function expect(value, code) {
  if (!value) failures.push({ code });
}

expect(manifest.id === 'local-agent-v1', 'LOCAL_AGENT_ID_INVALID');
expect(manifest.channel === 'local_agent', 'LOCAL_AGENT_CHANNEL_INVALID');
expect(manifest.transport === 'local-agent', 'LOCAL_AGENT_TRANSPORT_INVALID');
expect(manifest.mode === 'hybrid', 'LOCAL_AGENT_MODE_INVALID');
expect(manifest.mapping === 'server-side', 'LOCAL_AGENT_MAPPING_INVALID');
expect(manifest.capabilities.offline_queue === true, 'LOCAL_AGENT_OFFLINE_QUEUE_REQUIRED');
expect(manifest.capabilities.source_read_only === true, 'LOCAL_AGENT_READ_ONLY_REQUIRED');
expect(manifest.capabilities.preflight === true, 'LOCAL_AGENT_PREFLIGHT_REQUIRED');
expect(manifest.capabilities.issue === true, 'LOCAL_AGENT_ISSUE_REQUIRED');
expect(manifest.capabilities.status === true, 'LOCAL_AGENT_STATUS_REQUIRED');
expect(manifest.capabilities.sync === true, 'LOCAL_AGENT_SYNC_REQUIRED');
expect(manifest.security.secrets_server_side === true, 'LOCAL_AGENT_SERVER_SECRETS_REQUIRED');
expect(manifest.security.aeat_certificate_server_side === true, 'LOCAL_AGENT_AEAT_CERT_SERVER_REQUIRED');
expect(manifest.security.tenant_server_authoritative === true, 'LOCAL_AGENT_TENANT_SERVER_AUTHORITY_REQUIRED');

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    check: 'local-agent-contract-v1',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'local-agent-contract-v1',
  adapter_id: manifest.id,
  offline_queue: true,
  source_read_only: true,
  outbound_only_design: true,
}, null, 2));
