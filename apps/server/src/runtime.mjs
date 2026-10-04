import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from '../../api/src/handler.mjs';
import { ImportSessionService } from '../../api/src/imports.mjs';
import { FxAwareBridgeService } from '../../api/src/fx-bridge.mjs';
import { FiscalRecordService } from '../../../packages/core/src/fiscal-record-service.mjs';
import { createSqlitePersistence } from '../../../packages/sqlite-store/src/index.mjs';
import { createHttpAuthenticator } from './auth.mjs';
import { createIntegrationResolvers } from './integration-config.mjs';
import {
  KairosethIntegrationProfileControlPlane,
  createHybridIntegrationResolvers,
} from './integration-control-plane.mjs';
import { createKairosethAuthBridge } from './kairoseth-auth-bridge.mjs';
import { createPuenteHttpServer } from './http-server.mjs';
import { createOperationalObserver } from './observability.mjs';
import { KairosethLocalAgentControlPlane } from './local-agent-control-plane.mjs';
import { KairosethOnboardingControlPlane } from './onboarding-control-plane.mjs';
import {
  DEFAULT_NATIVE_CONNECTORS,
  resolveKairosethIntegrationStrategy,
} from '../../../packages/kairoseth-control-plane/src/capability-onboarding.mjs';
import { FixedWindowRateLimiter } from './rate-limit.mjs';

const DEFAULT_ONBOARDING_DIR = resolve(
  fileURLToPath(new URL('../../onboarding/', import.meta.url)),
);

function requiredString(value, name) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

function persistenceMode(value) {
  const mode = String(value ?? 'standalone').trim().toLowerCase();
  if (!['standalone', 'kairoseth'].includes(mode)) {
    throw new TypeError('persistenceMode must be standalone or kairoseth');
  }
  return mode;
}

function requiredInjectedStore(value, name) {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${name} is required in kairoseth persistence mode`);
  }
  return value;
}

export function createPuenteRuntime({
  persistenceMode: requestedPersistenceMode = 'standalone',
  databasePath = null,
  authConfig,
  integrationConfig = { integrations: [], euroConversions: [] },
  sif,
  onboardingDir = DEFAULT_ONBOARDING_DIR,
  rateLimiter = new FixedWindowRateLimiter(),
  clock = () => new Date(),
  observabilityClock = () => Date.now(),
  backupManifestPath = null,
  backupStatusProvider = null,
  persistenceHealthcheck = null,
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
  aeatOutboxStore = null,
  resolveIntegrationSecretReference = null,
  kairosethAuthProvider = null,
  supportedNativeConnectors = DEFAULT_NATIVE_CONNECTORS,
} = {}) {
  const mode = persistenceMode(requestedPersistenceMode);
  const normalizedSif = {
    systemId: requiredString(sif?.systemId, 'sif.systemId'),
    installationNumber: requiredString(sif?.installationNumber, 'sif.installationNumber'),
    timeZone: requiredString(sif?.timeZone, 'sif.timeZone'),
  };

  if (mode === 'standalone') {
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
  }

  let standalonePersistence = null;
  let runtimeHealthcheck = null;
  let selectedFiscalStore;
  let selectedIntegrationStore;
  let selectedImportSessionStore;
  let selectedImportBatchStore;
  let selectedLocalAgentStore;
  let selectedAeatOutbox;

  if (mode === 'standalone') {
    standalonePersistence = createSqlitePersistence({
      path: requiredString(databasePath, 'databasePath'),
    });
    selectedFiscalStore = fiscalRecordStore ?? standalonePersistence.fiscalStore;
    selectedIntegrationStore = integrationDataStore ?? standalonePersistence.integrationStore;
    selectedImportSessionStore = importSessionStore ?? standalonePersistence.importStore;
    selectedImportBatchStore = importBatchStore;
    selectedLocalAgentStore = localAgentRegistryStore ?? standalonePersistence.localAgentRegistry;
    selectedAeatOutbox = aeatOutboxStore ?? standalonePersistence.aeatOutbox;
  } else {
    selectedFiscalStore = requiredInjectedStore(
      fiscalRecordStore,
      'fiscalRecordStore',
    );
    selectedIntegrationStore = requiredInjectedStore(
      integrationDataStore,
      'integrationDataStore',
    );
    selectedImportSessionStore = requiredInjectedStore(
      importSessionStore,
      'importSessionStore',
    );
    selectedImportBatchStore = requiredInjectedStore(
      importBatchStore,
      'importBatchStore',
    );
    selectedLocalAgentStore = requiredInjectedStore(
      localAgentRegistryStore,
      'localAgentRegistryStore',
    );
    selectedAeatOutbox = requiredInjectedStore(
      aeatOutboxStore,
      'aeatOutboxStore',
    );
    requiredInjectedStore(onboardingProfileStore, 'onboardingProfileStore');
    requiredInjectedStore(integrationProfileStore, 'integrationProfileStore');
    if (typeof resolveIntegrationSecretReference !== 'function') {
      throw new TypeError(
        'resolveIntegrationSecretReference is required in kairoseth persistence mode',
      );
    }
    if (!kairosethAuthProvider) {
      throw new TypeError(
        'kairosethAuthProvider is required in kairoseth persistence mode',
      );
    }
    if (typeof backupStatusProvider !== 'function') {
      throw new TypeError(
        'backupStatusProvider is required in kairoseth persistence mode',
      );
    }
    runtimeHealthcheck = typeof persistenceHealthcheck === 'function'
      ? persistenceHealthcheck
      : (
          typeof selectedFiscalStore.healthcheck === 'function'
            ? () => selectedFiscalStore.healthcheck()
            : null
        );
    if (!runtimeHealthcheck) {
      throw new TypeError(
        'persistenceHealthcheck or fiscalRecordStore.healthcheck() is required in kairoseth persistence mode',
      );
    }
  }

  // Standalone process recovery can clear incomplete SQLite reservations because
  // one process owns the database. Kairoseth MongoDB reservations use leases and
  // must never be globally deleted on runtime startup.
  const recoveredReservations = standalonePersistence && !integrationDataStore
    ? standalonePersistence.database.db
      .prepare('DELETE FROM api_requests WHERE record_id IS NULL')
      .run().changes
    : 0;

  const fiscalService = new FiscalRecordService({
    sif: normalizedSif,
    store: selectedFiscalStore,
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
    store: selectedIntegrationStore,
    resolveEuroConversion: resolvers.resolveEuroConversion,
    presentationEnvironment,
  });
  const imports = new ImportSessionService({
    store: selectedImportSessionStore,
    ...(selectedImportBatchStore
      ? { batchStore: selectedImportBatchStore }
      : {}),
  });
  const localAgents = new KairosethLocalAgentControlPlane({
    store: selectedLocalAgentStore,
    clock: observabilityClock,
  });
  const resolveOnboardingStrategy = (input) => (
    resolveKairosethIntegrationStrategy(input, {
      supportedNativeConnectors,
    })
  );
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

  const operationalObserver = mode === 'standalone'
    ? createOperationalObserver({
        persistence: standalonePersistence,
        outbox: selectedAeatOutbox,
        backupManifestPath,
        clock: observabilityClock,
        thresholds: observabilityThresholds,
      })
    : createOperationalObserver({
        healthcheck: runtimeHealthcheck,
        outbox: selectedAeatOutbox,
        backupStatusProvider,
        mode: 'kairoseth-mongodb',
        clock: observabilityClock,
        thresholds: observabilityThresholds,
      });

  const readiness = mode === 'standalone'
    ? async () => {
        try {
          const row = standalonePersistence.database.db
            .prepare('SELECT 1 AS ok')
            .get();
          return { ok: row?.ok === 1 };
        } catch {
          return { ok: false };
        }
      }
    : async () => {
        try {
          const result = await runtimeHealthcheck();
          return { ok: result?.ok === true };
        } catch {
          return { ok: false };
        }
      };

  const server = createPuenteHttpServer({
    apiHandler,
    authenticateHttp,
    rateLimiter,
    onboardingDir,
    responsibleDeclarationPath,
    readiness,
    operationalStatus: async () => operationalObserver.snapshotAsync(),
  });

  const persistence = standalonePersistence ?? Object.freeze({
    mode: 'kairoseth-mongodb',
    database: null,
    fiscalStore: selectedFiscalStore,
    integrationStore: selectedIntegrationStore,
    importStore: selectedImportSessionStore,
    importBatchStore: selectedImportBatchStore,
    localAgentRegistry: selectedLocalAgentStore,
    aeatOutbox: selectedAeatOutbox,
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
    persistenceMode: mode,
    operationalObserver,
    recoveredReservations: Number(recoveredReservations),
    close: async () => {
      if (server.listening) {
        await new Promise((resolveClose, reject) => (
          server.close((error) => (
            error ? reject(error) : resolveClose()
          ))
        ));
      }
      standalonePersistence?.close();
    },
  };
}
