import { readFileSync } from 'node:fs';
import { validateUniversalAdapterManifest } from '../../packages/connector-contract-suite/src/adapter-manifest.mjs';

const manifest = validateUniversalAdapterManifest(
  JSON.parse(readFileSync('packages/local-agent/adapter-manifest.json', 'utf8')),
);

const runtimeSource = readFileSync('packages/local-agent/src/runtime.mjs', 'utf8');
const configSource = readFileSync('packages/local-agent/src/config.mjs', 'utf8');
const cliSource = readFileSync('packages/local-agent/src/cli.mjs', 'utf8');
const exampleConfig = JSON.parse(readFileSync('config/local-agent.example.json', 'utf8'));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const versionSource = readFileSync('packages/local-agent/src/version.mjs', 'utf8');

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

expect(!runtimeSource.includes("from 'node:http'"), 'LOCAL_AGENT_INBOUND_HTTP_FORBIDDEN');
expect(!runtimeSource.includes('createServer('), 'LOCAL_AGENT_SERVER_LISTENER_FORBIDDEN');
expect(!runtimeSource.includes('.listen('), 'LOCAL_AGENT_LISTEN_FORBIDDEN');
expect(runtimeSource.includes('/readyz'), 'LOCAL_AGENT_DOCTOR_READY_PROBE_REQUIRED');
expect(configSource.includes('VF_LOCAL_AGENT_CONFIG_INLINE_SECRET_FORBIDDEN'), 'LOCAL_AGENT_INLINE_SECRET_GUARD_REQUIRED');
expect(cliSource.includes("'start', 'once', 'status', 'doctor'"), 'LOCAL_AGENT_CLI_COMMANDS_REQUIRED');
expect(exampleConfig.schemaVersion === 1, 'LOCAL_AGENT_CONFIG_SCHEMA_INVALID');
expect(exampleConfig.source?.issueEnabled === false, 'LOCAL_AGENT_EXAMPLE_MUST_FAIL_CLOSED');
expect(typeof exampleConfig.bridge?.apiKeyEnv === 'string', 'LOCAL_AGENT_API_KEY_ENV_REQUIRED');
expect(exampleConfig.bridge?.apiKey == null, 'LOCAL_AGENT_INLINE_API_KEY_FORBIDDEN');
expect(exampleConfig.runtime?.heartbeatIntervalMs === 60000, 'LOCAL_AGENT_HEARTBEAT_INTERVAL_EXAMPLE_INVALID');
expect(versionSource.includes(`LOCAL_AGENT_VERSION = '${packageJson.version}'`), 'LOCAL_AGENT_VERSION_MUST_MATCH_PACKAGE');

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
  runtime_cli: true,
  config_fail_closed: true,
  heartbeat_control_plane: true,
}, null, 2));
