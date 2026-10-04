import { readFileSync } from 'node:fs';

const adapter = readFileSync('packages/kairoseth-control-plane/src/mongodb-local-agent-registry.mjs', 'utf8');
const onboardingAdapter = readFileSync('packages/kairoseth-control-plane/src/mongodb-onboarding-profiles.mjs', 'utf8');
const onboardingRuntime = readFileSync('apps/server/src/onboarding-control-plane.mjs', 'utf8');
const integrationAdapter = readFileSync('packages/kairoseth-control-plane/src/mongodb-integration-profiles.mjs', 'utf8');
const importAdapter = readFileSync('packages/kairoseth-control-plane/src/mongodb-import-batches.mjs', 'utf8');
const dataPlaneAdapter = readFileSync('packages/kairoseth-control-plane/src/mongodb-dataplane.mjs', 'utf8');
const aeatOutboxAdapter = readFileSync('packages/kairoseth-control-plane/src/mongodb-aeat-outbox.mjs', 'utf8');
const integrationRuntime = readFileSync('apps/server/src/integration-control-plane.mjs', 'utf8');
const serverRuntime = readFileSync('apps/server/src/runtime.mjs', 'utf8');
const authBridge = readFileSync('apps/server/src/kairoseth-auth-bridge.mjs', 'utf8');
const product = JSON.parse(readFileSync('config/kairoseth-extension.json', 'utf8'));
const index = readFileSync('packages/kairoseth-control-plane/src/index.mjs', 'utf8');

const failures = [];
const expect = (condition, code) => { if (!condition) failures.push({ code }); };

expect(product.infrastructure?.hosting_provider === 'hostinger', 'KAIROSETH_HOSTING_MUST_BE_HOSTINGER');
expect(product.infrastructure?.primary_database === 'mongodb', 'KAIROSETH_PRIMARY_DATABASE_MUST_BE_MONGODB');
expect(product.infrastructure?.control_plane_persistence === 'mongodb', 'KAIROSETH_CONTROL_PLANE_MUST_USE_MONGODB');
expect(product.infrastructure?.local_agent_registry === 'mongodb-injected', 'KAIROSETH_AGENT_REGISTRY_MUST_USE_MONGODB');
expect(product.infrastructure?.onboarding_profiles === 'mongodb-injected', 'KAIROSETH_ONBOARDING_PROFILES_MUST_USE_MONGODB');
expect(product.infrastructure?.integration_profiles === 'mongodb-injected', 'KAIROSETH_INTEGRATION_PROFILES_MUST_USE_MONGODB');
expect(product.infrastructure?.data_plane_auth === 'kairoseth-injected', 'KAIROSETH_DATA_PLANE_AUTH_MUST_BE_INJECTED');
expect(product.infrastructure?.import_sessions === 'mongodb-injected-ttl', 'KAIROSETH_IMPORT_SESSIONS_MUST_USE_MONGODB_TTL');
expect(product.infrastructure?.import_batches === 'mongodb-injected-durable', 'KAIROSETH_IMPORT_BATCHES_MUST_USE_MONGODB');
expect(product.infrastructure?.fiscal_records === 'mongodb-injected-durable', 'KAIROSETH_FISCAL_RECORDS_MUST_USE_MONGODB');
expect(product.infrastructure?.api_records === 'mongodb-injected-durable', 'KAIROSETH_API_RECORDS_MUST_USE_MONGODB');
expect(product.infrastructure?.api_idempotency === 'mongodb-injected-lease', 'KAIROSETH_API_IDEMPOTENCY_MUST_USE_MONGODB');
expect(product.infrastructure?.aeat_outbox === 'mongodb-injected-durable', 'KAIROSETH_AEAT_OUTBOX_MUST_USE_MONGODB');
expect(product.infrastructure?.runtime_persistence === 'mongodb-only', 'KAIROSETH_RUNTIME_PERSISTENCE_MUST_BE_MONGODB_ONLY');
expect(product.infrastructure?.backup_status === 'kairoseth-injected', 'KAIROSETH_BACKUP_STATUS_MUST_BE_INJECTED');
expect(product.infrastructure?.observability === 'mongodb-aware', 'KAIROSETH_OBSERVABILITY_MUST_BE_MONGODB_AWARE');
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
expect(integrationAdapter.includes('database.collection'), 'KAIROSETH_INTEGRATION_MONGODB_INJECTION_REQUIRED');
expect(!/from ['"]mongodb['"]|require\(['"]mongodb['"]\)|new\s+MongoClient\s*\(/.test(integrationAdapter), 'KAIROSETH_INTEGRATION_MONGO_CLIENT_MUST_BE_INJECTED');
expect(!/MONGODB_URI|MONGO_URI|process\.env|mongodb\+srv:|mongodb:\/\//.test(integrationAdapter), 'KAIROSETH_INTEGRATION_MONGO_SECRET_FORBIDDEN');
expect(!/createCollection\s*\(|createIndex(?:es)?\s*\(/.test(integrationAdapter), 'KAIROSETH_INTEGRATION_AUTO_INFRA_MUTATION_FORBIDDEN');
expect(index.includes('mongodb-integration-profiles.mjs'), 'KAIROSETH_INTEGRATION_MONGODB_EXPORT_REQUIRED');
expect(importAdapter.includes('database.collection'), 'KAIROSETH_IMPORT_MONGODB_INJECTION_REQUIRED');
expect(!/from ['"]mongodb['"]|require\(['"]mongodb['"]\)|new\s+MongoClient\s*\(/.test(importAdapter), 'KAIROSETH_IMPORT_MONGO_CLIENT_MUST_BE_INJECTED');
expect(!/MONGODB_URI|MONGO_URI|process\.env|mongodb\+srv:|mongodb:\/\//.test(importAdapter), 'KAIROSETH_IMPORT_MONGO_SECRET_FORBIDDEN');
expect(!/createCollection\s*\(|createIndex(?:es)?\s*\(/.test(importAdapter), 'KAIROSETH_IMPORT_AUTO_INFRA_MUTATION_FORBIDDEN');
expect(index.includes('mongodb-import-batches.mjs'), 'KAIROSETH_IMPORT_MONGODB_EXPORT_REQUIRED');
expect(dataPlaneAdapter.includes('database.collection'), 'KAIROSETH_DATAPLANE_MONGODB_INJECTION_REQUIRED');
expect(!/from ['"]mongodb['"]|require\(['"]mongodb['"]\)|new\s+MongoClient\s*\(/.test(dataPlaneAdapter), 'KAIROSETH_DATAPLANE_MONGO_CLIENT_MUST_BE_INJECTED');
expect(!/MONGODB_URI|MONGO_URI|process\.env|mongodb\+srv:|mongodb:\/\//.test(dataPlaneAdapter), 'KAIROSETH_DATAPLANE_MONGO_SECRET_FORBIDDEN');
expect(!/createCollection\s*\(|createIndex(?:es)?\s*\(/.test(dataPlaneAdapter), 'KAIROSETH_DATAPLANE_AUTO_INFRA_MUTATION_FORBIDDEN');
expect(index.includes('mongodb-dataplane.mjs'), 'KAIROSETH_DATAPLANE_MONGODB_EXPORT_REQUIRED');
expect(aeatOutboxAdapter.includes('database.collection'), 'KAIROSETH_AEAT_OUTBOX_MONGODB_INJECTION_REQUIRED');
expect(!/from ['"]mongodb['"]|require\(['"]mongodb['"]\)|new\s+MongoClient\s*\(/.test(aeatOutboxAdapter), 'KAIROSETH_AEAT_OUTBOX_MONGO_CLIENT_MUST_BE_INJECTED');
expect(!/MONGODB_URI|MONGO_URI|process\.env|mongodb\+srv:|mongodb:\/\//.test(aeatOutboxAdapter), 'KAIROSETH_AEAT_OUTBOX_MONGO_SECRET_FORBIDDEN');
expect(!/createCollection\s*\(|createIndex(?:es)?\s*\(/.test(aeatOutboxAdapter), 'KAIROSETH_AEAT_OUTBOX_AUTO_INFRA_MUTATION_FORBIDDEN');
expect(index.includes('mongodb-aeat-outbox.mjs'), 'KAIROSETH_AEAT_OUTBOX_MONGODB_EXPORT_REQUIRED');
expect(serverRuntime.includes("persistenceMode: requestedPersistenceMode = 'standalone'"), 'KAIROSETH_RUNTIME_MODE_REQUIRED');
expect(serverRuntime.includes("if (mode === 'standalone')"), 'KAIROSETH_STANDALONE_BOUNDARY_REQUIRED');
expect(serverRuntime.includes("mode === 'kairoseth'") || serverRuntime.includes("mode === 'standalone'"), 'KAIROSETH_RUNTIME_MODE_BRANCH_REQUIRED');
expect(serverRuntime.includes("selectedFiscalStore = requiredInjectedStore"), 'KAIROSETH_FISCAL_STORE_REQUIRED_IN_PRODUCTIVE_MODE');
expect(serverRuntime.includes("selectedIntegrationStore = requiredInjectedStore"), 'KAIROSETH_API_STORE_REQUIRED_IN_PRODUCTIVE_MODE');
expect(serverRuntime.includes("selectedImportSessionStore = requiredInjectedStore"), 'KAIROSETH_IMPORT_SESSION_REQUIRED_IN_PRODUCTIVE_MODE');
expect(serverRuntime.includes("selectedImportBatchStore = requiredInjectedStore"), 'KAIROSETH_IMPORT_BATCH_REQUIRED_IN_PRODUCTIVE_MODE');
expect(serverRuntime.includes("selectedAeatOutbox = requiredInjectedStore"), 'KAIROSETH_AEAT_OUTBOX_REQUIRED_IN_PRODUCTIVE_MODE');
expect(serverRuntime.includes("requiredInjectedStore(onboardingProfileStore, 'onboardingProfileStore')"), 'KAIROSETH_ONBOARDING_STORE_REQUIRED_IN_PRODUCTIVE_MODE');
expect(serverRuntime.includes("requiredInjectedStore(integrationProfileStore, 'integrationProfileStore')"), 'KAIROSETH_INTEGRATION_STORE_REQUIRED_IN_PRODUCTIVE_MODE');
expect(serverRuntime.includes("resolveIntegrationSecretReference is required in kairoseth persistence mode"), 'KAIROSETH_SECRET_RESOLVER_REQUIRED_IN_PRODUCTIVE_MODE');
expect(serverRuntime.includes("kairosethAuthProvider is required in kairoseth persistence mode"), 'KAIROSETH_AUTH_PROVIDER_REQUIRED_IN_PRODUCTIVE_MODE');
expect(serverRuntime.includes("backupStatusProvider is required in kairoseth persistence mode"), 'KAIROSETH_BACKUP_STATUS_PROVIDER_REQUIRED');
expect(serverRuntime.includes("database: null"), 'KAIROSETH_RUNTIME_MUST_EXPOSE_NO_SQLITE_DATABASE');
expect((serverRuntime.match(/createSqlitePersistence\s*\(/g) ?? []).length === 1, 'KAIROSETH_SQLITE_FACTORY_CALL_MUST_BE_SINGLE');
expect(serverRuntime.includes("standalonePersistence = createSqlitePersistence"), 'KAIROSETH_SQLITE_MUST_BE_STANDALONE_ONLY');
expect(integrationRuntime.includes('createHybridIntegrationResolvers'), 'KAIROSETH_HYBRID_INTEGRATION_RESOLVER_REQUIRED');
expect(integrationRuntime.includes('dynamicProfiles.resolveMappingProfile'), 'KAIROSETH_DYNAMIC_MAPPING_RESOLVER_REQUIRED');
expect(!serverRuntime.includes('integrationProfileStore ?? persistence'), 'KAIROSETH_INTEGRATION_SQLITE_FALLBACK_FORBIDDEN');
expect(serverRuntime.includes('createKairosethAuthBridge'), 'KAIROSETH_AUTH_BRIDGE_REQUIRED');
expect(serverRuntime.includes('authBridge.resolveBearerDigest'), 'KAIROSETH_AUTH_BEARER_RESOLVER_REQUIRED');
expect(!/MongoClient|database\.collection|tokenSha256|password/i.test(authBridge), 'KAIROSETH_AUTH_BRIDGE_PERSISTENCE_FORBIDDEN');
expect(authBridge.includes('provisionDataPlaneCredential'), 'KAIROSETH_AUTH_PROVISION_PROVIDER_REQUIRED');
expect(authBridge.includes('rotateDataPlaneCredential'), 'KAIROSETH_AUTH_ROTATE_PROVIDER_REQUIRED');
expect(authBridge.includes('revokeDataPlaneCredential'), 'KAIROSETH_AUTH_REVOKE_PROVIDER_REQUIRED');
expect(!/tokenSha256|passwordHash|passwordScrypt/.test(integrationAdapter), 'KAIROSETH_INTEGRATION_AUTH_SECRET_PERSISTENCE_FORBIDDEN');

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
  integration_profiles: 'mongodb-tenant-installation-bound',
  integration_json_role: 'reference-fallback',
  integration_sqlite_fallback: false,
  data_plane_auth: 'kairoseth-injected',
  import_sessions: 'mongodb-ttl',
  import_batches: 'mongodb-durable',
  fiscal_records: 'mongodb-durable',
  api_records: 'mongodb-durable',
  api_idempotency: 'mongodb-lease',
  aeat_outbox: 'mongodb-durable',
  runtime_persistence: 'mongodb-only',
  backup_status: 'kairoseth-injected',
  observability: 'mongodb-aware',
  dynamic_auth_secret_persistence: false,
}, null, 2));
