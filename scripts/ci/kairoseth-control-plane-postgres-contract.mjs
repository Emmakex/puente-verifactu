import { readFileSync } from 'node:fs';

const adapter = readFileSync('packages/kairoseth-control-plane/src/postgres-local-agent-registry.mjs', 'utf8');
const runtime = readFileSync('apps/server/src/runtime.mjs', 'utf8');
const service = readFileSync('apps/server/src/local-agent-control-plane.mjs', 'utf8');

const failures = [];
function expect(condition, code) {
  if (!condition) failures.push({ code });
}

expect(!/from ['"]pg['"]|require\(['"]pg['"]\)|new\s+Pool\s*\(/.test(adapter), 'KAIROSETH_REGISTRY_PG_CLIENT_MUST_BE_INJECTED');
expect(!/process\.env|DATABASE_URL|connectionString|password\s*:/.test(adapter), 'KAIROSETH_REGISTRY_CONNECTION_SECRET_FORBIDDEN');
expect(adapter.includes('pool.query'), 'KAIROSETH_REGISTRY_QUERY_INTERFACE_REQUIRED');
expect(adapter.includes('postgresLocalAgentRegistryMigrationSql'), 'KAIROSETH_REGISTRY_EXPLICIT_MIGRATION_REQUIRED');
expect(!/constructor[\s\S]{0,600}CREATE TABLE/i.test(adapter), 'KAIROSETH_REGISTRY_AUTO_MIGRATION_FORBIDDEN');
expect(adapter.includes('token_sha256'), 'KAIROSETH_REGISTRY_TOKEN_HASH_REQUIRED');
expect(!/\btoken\s+TEXT\b|\bpassword\s+TEXT\b/i.test(adapter), 'KAIROSETH_REGISTRY_CLEAR_SECRET_COLUMN_FORBIDDEN');
expect(runtime.includes('localAgentRegistryStore = null'), 'KAIROSETH_REGISTRY_INJECTION_POINT_REQUIRED');
expect(runtime.includes('localAgentRegistryStore ?? persistence.localAgentRegistry'), 'KAIROSETH_REGISTRY_REFERENCE_FALLBACK_REQUIRED');
expect(service.includes('async authenticateBearerDigest'), 'KAIROSETH_REGISTRY_ASYNC_AUTH_REQUIRED');
expect(service.includes('await this.store.heartbeat'), 'KAIROSETH_REGISTRY_ASYNC_HEARTBEAT_REQUIRED');

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    check: 'kairoseth-control-plane-postgres-contract',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'kairoseth-control-plane-postgres-contract',
  injected_pool: true,
  automatic_migration: false,
  connection_secrets_in_adapter: false,
  cleartext_agent_token_schema: false,
  sqlite_reference_fallback: true,
}, null, 2));
