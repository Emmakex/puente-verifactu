import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from '../../api/src/handler.mjs';
import { ImportSessionService } from '../../api/src/imports.mjs';
import { FxAwareBridgeService } from '../../api/src/fx-bridge.mjs';
import { FiscalRecordService } from '../../../packages/core/src/fiscal-record-service.mjs';
import { createSqlitePersistence } from '../../../packages/sqlite-store/src/index.mjs';
import { createHttpAuthenticator } from './auth.mjs';
import { createIntegrationResolvers } from './integration-config.mjs';
import { KairosethIntegrationProfileControlPlane, createHybridIntegrationResolvers } from './integration-control-plane.mjs';
import { createKairosethAuthBridge } from './kairoseth-auth-bridge.mjs';
import { createPuenteHttpServer } from './http-server.mjs';
import { createOperationalObserver } from './observability.mjs';
import { KairosethLocalAgentControlPlane } from './local-agent-control-plane.mjs';
import { KairosethOnboardingControlPlane } from './onboarding-control-plane.mjs';
import { DEFAULT_NATIVE_CONNECTORS, resolveKairosethIntegrationStrategy } from '../../../packages/kairoseth-control-plane/src/capability-onboarding.mjs';
import { FixedWindowRateLimiter } from './rate-limit.mjs';

const DEFAULT_ONBOARDING_DIR = resolve(fileURLToPath(new URL('../../onboarding/', import.meta.url)));

function requiredString(value, name) {
  if (!value || typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

export function createPuenteRuntime({
  databasePath,
  authConfig,
  integrationConfig = { integrations: [], euroConversions: [] },
  sif,
  onboardingDir = DEFAULT_ONBOARDING_DIR,
  rateLimiter = new FixedWindowRateLimiter(),
  clock = () => new Date(),
  observabilityClock = () => Date.now(),
  backupManifestPath = null,
  responsibleDeclarationPath = null,
  presentationEnvironment = 'test',
  observabilityThresholds = {},
  localAgentRegistryStore = null,
  onboardingProfileStore = null,
  integrationProfileStore = null,
  importSessionStore = null,
  importBatchStore = null,
  fiscalRecordStore = null,
  integrationDataStore = null,
  resolveIntegrationSecretReference = null,
  kairosethAuthProvider = null,
  supportedNativeConnectors = DEFAULT_NATIVE_CONNECTORS,
} = {}) {
  const normalizedSif = {
    systemId: requiredString(sif?.systemId, 'sif.systemId'),
    installationNumber: requiredString(sif?.installationNumber, 'sif.installationNumber'),
    timeZone: requiredString(sif?.timeZone, 'sif.timeZone'),
  };

  if ((importSessionStore == null) !== (importBatchStore == null)) {
    throw new TypeError(
      'importSessionStore and importBatchStore must be injected together',
    );
  }
  if ((fiscalRecordStore == null) !== (integrationDataStore == null)) {
    throw new TypeError(
      'fiscalRecordStore and integrationDataStore must be injected together',
    );
  }

  const persistence = createSqlitePersistence({ path: requiredString(databasePath, 'databasePath') });
  // Single-node runtime recovery: after a process restart no in-flight HTTP request can still own
  // a pending reservation. Fiscal operations are independently idempotent, so a retry can safely
  // reconstruct the same durable API resource if the process stopped between fiscalization and completion.
  const recoveredReservations = integrationDataStore
    ? 0
    : persistence.database.db
      .prepare('DELETE FROM api_requests WHERE record_id IS NULL')
      .run().changes;

  const fiscalService = new FiscalRecordService({
    sif: normalizedSif,
    store: fiscalRecordStore ?? persistence.fiscalStore,
    clock,
  });
  const staticResolvers = createIntegrationResolvers(integrationConfig);
  const authBridge = createKairosethAuthBridge(kairosethAuthProvider);
  const integrationProfiles = integrationProfileStore
    ? new KairosethIntegrationProfileControlPlane({
        store: integrationProfileStore,
        onboardingStore: onboardingProfileStore,
        resolveSecretReference: resolveIntegrationSecretReference,
        authBridge,
        clock: observabilityClock,
      })
    : null;
  const resolvers = createHybridIntegrationResolvers({
    staticResolvers,
    dynamicProfiles: integrationProfiles,
  });
  const bridge = new FxAwareBridgeService({
    fiscalService,
    store: integrationDataStore ?? persistence.integrationStore,
    resolveEuroConversion: resolvers.resolveEuroConversion,
    presentationEnvironment,
  });
  const imports = new ImportSessionService({
    // SQLite remains the standalone reference fallback. Kairoseth production injects
    // tenant-aware MongoDB session/batch stores without giving Puente Mongo credentials.
    store: importSessionStore ?? persistence.importStore,
    ...(importBatchStore ? { batchStore: importBatchStore } : {}),
  });
  const localAgents = new KairosethLocalAgentControlPlane({
    // SQLite is the single-node reference store only. Kairoseth production can inject
    // its shared tenant-aware persistence without changing the control-plane service.
    store: localAgentRegistryStore ?? persistence.localAgentRegistry,
    clock: observabilityClock,
  });
  const resolveOnboardingStrategy = (input) => resolveKairosethIntegrationStrategy(input, {
    supportedNativeConnectors,
  });
  const onboardingProfiles = onboardingProfileStore
    ? new KairosethOnboardingControlPlane({
        store: onboardingProfileStore,
        localAgents,
        resolveStrategy: resolveOnboardingStrategy,
        integrationProfiles,
        clock: observabilityClock,
      })
    : null;
  const authenticateHttp = createHttpAuthenticator(authConfig, {
    resolveBearerDigest: async (digest) => (
      await localAgents.authenticateBearerDigest(digest)
      ?? (authBridge ? await authBridge.resolveBearerDigest(digest) : null)
    ),
  });
  const apiHandler = createApiHandler({
    bridge,
    imports,
    authenticate: async (request) => request.authContext,
    resolveMappingProfile: resolvers.resolveMappingProfile,
    resolveWebhookSecret: resolvers.resolveWebhookSecret,
    localAgents,
    onboardingProfiles,
    integrationProfiles,
    resolveOnboardingStrategy,
  });
  const operationalObserver = createOperationalObserver({
    persistence,
    backupManifestPath,
    clock: observabilityClock,
    thresholds: observabilityThresholds,
  });
  const server = createPuenteHttpServer({
    apiHandler,
    authenticateHttp,
    rateLimiter,
    onboardingDir,
    responsibleDeclarationPath,
    readiness: async () => {
      try {
        const row = persistence.database.db.prepare('SELECT 1 AS ok').get();
        return { ok: row?.ok === 1 };
      } catch {
        return { ok: false };
      }
    },
    operationalStatus: async () => operationalObserver.snapshot(),
  });

  return {
    server,
    bridge,
    imports,
    localAgents,
    onboardingProfiles,
    integrationProfiles,
    authBridge,
    persistence,
    operationalObserver,
    recoveredReservations: Number(recoveredReservations),
    close: async () => {
      if (server.listening) await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      persistence.close();
    },
  };
}
