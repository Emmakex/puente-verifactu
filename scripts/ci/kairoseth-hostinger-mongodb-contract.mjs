import { readFileSync } from 'node:fs';

const adapter = readFileSync('packages/kairoseth-control-plane/src/mongodb-local-agent-registry.mjs', 'utf8');
const onboardingAdapter = readFileSync('packages/kairoseth-control-plane/src/mongodb-onboarding-profiles.mjs', 'utf8');
const onboardingRuntime = readFileSync('apps/server/src/onboarding-control-plane.mjs', 'utf8');
const product = JSON.parse(readFileSync('config/kairoseth-extension.json', 'utf8'));
const index = readFileSync('packages/kairoseth-control-plane/src/index.mjs', 'utf8');

const failures = [];
const expect = (condition, code) => { if (!condition) failures.push({ code }); };

expect(product.infrastructure?.hosting_provider === 'hostinger', 'KAIROSETH_HOSTING_MUST_BE_HOSTINGER');
expect(product.infrastructure?.primary_database === 'mongodb', 'KAIROSETH_PRIMARY_DATABASE_MUST_BE_MONGODB');
expect(product.infrastructure?.control_plane_persistence === 'mongodb', 'KAIROSETH_CONTROL_PLANE_MUST_USE_MONGODB');
expect(product.infrastructure?.local_agent_registry === 'mongodb-injected', 'KAIROSETH_AGENT_REGISTRY_MUST_USE_MONGODB');
expect(adapter.includes('database.collection'), 'KAIROSETH_MONGODB_DATABASE_INJECTION_REQUIRED');
expect(!/from ['"]mongodb['"]|require\(['"]mongodb['"]\)|new\s+MongoClient\s*\(/.test(adapter), 'KAIROSETH_MONGODB_CLIENT_MUST_BE_INJECTED');
expect(!/MONGODB_URI|MONGO_URI|process\.env|mongodb\+srv:|mongodb:\/\//.test(adapter), 'KAIROSETH_MONGODB_CONNECTION_SECRET_FORBIDDEN');
expect(!/createCollection\s*\(|createIndex(?:es)?\s*\(/.test(adapter), 'KAIROSETH_MONGODB_AUTO_INFRA_MUTATION_FORBIDDEN');
expect(adapter.includes('tokenSha256'), 'KAIROSETH_AGENT_TOKEN_HASH_REQUIRED');
expect(!/\btoken\s*:|\bpassword\s*:|privateKey\s*:/.test(adapter), 'KAIROSETH_CLEAR_SECRET_FIELD_FORBIDDEN');
expect(index.includes('mongodb-local-agent-registry.mjs'), 'KAIROSETH_MONGODB_REGISTRY_EXPORT_REQUIRED');
expect(!index.includes('postgres-local-agent-registry.mjs'), 'KAIROSETH_POSTGRES_REGISTRY_EXPORT_FORBIDDEN');
expect(onboardingAdapter.includes('database.collection'), 'KAIROSETH_ONBOARDING_MONGODB_INJECTION_REQUIRED');
expect(!/from ['"]mongodb['"]|require\(['"]mongodb['"]\)|new\s+MongoClient\s*\(/.test(onboardingAdapter), 'KAIROSETH_ONBOARDING_MONGO_CLIENT_MUST_BE_INJECTED');
expect(!/MONGODB_URI|MONGO_URI|process\.env|mongodb\+srv:|mongodb:\/\//.test(onboardingAdapter), 'KAIROSETH_ONBOARDING_MONGO_SECRET_FORBIDDEN');
expect(!/createCollection\s*\(|createIndex(?:es)?\s*\(/.test(onboardingAdapter), 'KAIROSETH_ONBOARDING_AUTO_INFRA_MUTATION_FORBIDDEN');
expect(index.includes('mongodb-onboarding-profiles.mjs'), 'KAIROSETH_ONBOARDING_MONGODB_EXPORT_REQUIRED');
expect(onboardingRuntime.includes('organizationId = requireContext(context)'), 'KAIROSETH_ONBOARDING_TENANT_CONTEXT_REQUIRED');
expect(!onboardingRuntime.includes('onboardingProfileStore ?? persistence'), 'KAIROSETH_ONBOARDING_SQLITE_FALLBACK_FORBIDDEN');

if (failures.length) {
  console.error(JSON.stringify({ schema_version: 1, status: 'failed', check: 'kairoseth-hostinger-mongodb-contract', failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'kairoseth-hostinger-mongodb-contract',
  hosting: 'hostinger',
  database: 'mongodb',
  injected_database: true,
  automatic_collection_creation: false,
  connection_secrets_in_adapter: false,
  cleartext_agent_token_schema: false,
  onboarding_profiles: 'mongodb-tenant-bound',
  onboarding_sqlite_fallback: false,
}, null, 2));
