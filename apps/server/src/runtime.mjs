import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from '../../api/src/handler.mjs';
import { ImportSessionService } from '../../api/src/imports.mjs';
import { UniversalBridgeService } from '../../api/src/service.mjs';
import { FiscalRecordService } from '../../../packages/core/src/fiscal-record-service.mjs';
import { createSqlitePersistence } from '../../../packages/sqlite-store/src/index.mjs';
import { createHttpAuthenticator } from './auth.mjs';
import { createIntegrationResolvers } from './integration-config.mjs';
import { createPuenteHttpServer } from './http-server.mjs';
import { FixedWindowRateLimiter } from './rate-limit.mjs';

const DEFAULT_ONBOARDING_DIR = resolve(fileURLToPath(new URL('../../onboarding/', import.meta.url)));

function requiredString(value, name) {
  if (!value || typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}

export function createPuenteRuntime({
  databasePath,
  authConfig,
  integrationConfig = { integrations: [] },
  sif,
  onboardingDir = DEFAULT_ONBOARDING_DIR,
  rateLimiter = new FixedWindowRateLimiter(),
  clock = () => new Date(),
} = {}) {
  const normalizedSif = {
    systemId: requiredString(sif?.systemId, 'sif.systemId'),
    installationNumber: requiredString(sif?.installationNumber, 'sif.installationNumber'),
    timeZone: requiredString(sif?.timeZone, 'sif.timeZone'),
  };

  const persistence = createSqlitePersistence({ path: requiredString(databasePath, 'databasePath') });
  // Single-node runtime recovery: after a process restart no in-flight HTTP request can still own
  // a pending reservation. Fiscal operations are independently idempotent, so a retry can safely
  // reconstruct the same durable API resource if the process stopped between fiscalization and completion.
  const recoveredReservations = persistence.database.db
    .prepare('DELETE FROM api_requests WHERE record_id IS NULL')
    .run().changes;

  const fiscalService = new FiscalRecordService({
    sif: normalizedSif,
    store: persistence.fiscalStore,
    clock,
  });
  const bridge = new UniversalBridgeService({
    fiscalService,
    store: persistence.integrationStore,
  });
  const imports = new ImportSessionService({ store: persistence.importStore });
  const authenticateHttp = createHttpAuthenticator(authConfig);
  const resolvers = createIntegrationResolvers(integrationConfig);
  const apiHandler = createApiHandler({
    bridge,
    imports,
    authenticate: async (request) => request.authContext,
    resolveMappingProfile: resolvers.resolveMappingProfile,
    resolveWebhookSecret: resolvers.resolveWebhookSecret,
  });
  const server = createPuenteHttpServer({
    apiHandler,
    authenticateHttp,
    rateLimiter,
    onboardingDir,
    readiness: async () => {
      try {
        const row = persistence.database.db.prepare('SELECT 1 AS ok').get();
        return { ok: row?.ok === 1 };
      } catch {
        return { ok: false };
      }
    },
  });

  return {
    server,
    bridge,
    imports,
    persistence,
    recoveredReservations: Number(recoveredReservations),
    close: async () => {
      if (server.listening) await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      persistence.close();
    },
  };
}
