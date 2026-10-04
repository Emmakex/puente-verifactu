import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient, ServerApiVersion } from 'mongodb';
import {
  AeatOutboxWorker,
  AeatVerifactuAdapter,
  createHttpsMtlsTransport,
} from '../../../packages/aeat-adapter/src/index.mjs';
import {
  createMongoKairosethAeatOutboxStore,
  createMongoKairosethFiscalAuthProvider,
  createMongoKairosethFiscalRecordStore,
  createMongoKairosethImportBatchStore,
  createMongoKairosethImportSessionStore,
  createMongoKairosethIntegrationProfileStore,
  createMongoKairosethIntegrationStore,
  createMongoKairosethLocalAgentRegistryStore,
  createMongoKairosethOnboardingProfileStore,
  verifyKairosethMongoIndexes,
} from '../../../packages/kairoseth-control-plane/src/index.mjs';
import { loadAuthConfig } from './auth.mjs';
import { createAeatDeliveryQueue, createAeatDispatchLoop } from './aeat-delivery.mjs';
import { loadRuntimeAeatTls } from './aeat-credentials.mjs';
import { loadIntegrationConfig } from './integration-config.mjs';
import { createKairosethBackupStatusProvider } from './kairoseth-backup-status.mjs';
import { loadPrivateSecretResolver } from './private-secret-resolver.mjs';
import { createPuenteRuntime } from './runtime.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) {
    const error = new Error(`${name} is required`);
    error.code = 'VF_KAIROSETH_PRODUCTION_CONFIG_REQUIRED';
    error.field = name;
    throw error;
  }
  return text;
}

function integer(value, fallback, name, min, max) {
  const candidate = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return candidate;
}

async function packageVersion() {
  const packageJson = JSON.parse(await readFile(resolve(REPO_ROOT, 'package.json'), 'utf8'));
  return required(packageJson.version, 'package.version');
}

function mongoClient(uri) {
  return new MongoClient(uri, {
    appName: 'kairoseth-fiscal',
    family: 4,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
}

function aeatEnvironment(env) {
  const value = String(env.PV_AEAT_ENVIRONMENT ?? 'test').trim().toLowerCase();
  if (!['test', 'production'].includes(value)) {
    throw new TypeError('PV_AEAT_ENVIRONMENT must be test or production');
  }
  if (value === 'production' && env.PV_AEAT_ALLOW_PRODUCTION !== 'YES') {
    const error = new Error('AEAT production requires PV_AEAT_ALLOW_PRODUCTION=YES');
    error.code = 'VF_AEAT_PRODUCTION_GUARD';
    throw error;
  }
  return value;
}

async function sifConfig(env) {
  return Object.freeze({
    producerName: required(env.PV_SIF_PRODUCER_NAME, 'PV_SIF_PRODUCER_NAME'),
    producerTaxId: required(env.PV_SIF_PRODUCER_TAX_ID, 'PV_SIF_PRODUCER_TAX_ID'),
    softwareName: String(env.PV_SIF_SOFTWARE_NAME ?? 'Puente VeriFactu').trim(),
    systemId: required(env.PV_SIF_SYSTEM_ID, 'PV_SIF_SYSTEM_ID'),
    version: await packageVersion(),
    installationNumber: required(
      env.PV_SIF_INSTALLATION_NUMBER,
      'PV_SIF_INSTALLATION_NUMBER',
    ),
    onlyVerifactu: true,
    possibleMultiTaxpayer: true,
    multipleTaxpayers: true,
    timeZone: String(env.PV_TIME_ZONE ?? 'Europe/Madrid').trim(),
  });
}

export async function buildKairosethProductionService(env = process.env) {
  const uri = required(env.MONGODB_URI, 'MONGODB_URI');
  const databaseName = String(env.MONGODB_DB_NAME ?? 'kairoseth').trim();
  if (databaseName !== 'kairoseth') {
    const error = new Error('Productive Kairoseth Fiscal must use MONGODB_DB_NAME=kairoseth');
    error.code = 'VF_KAIROSETH_DATABASE_PROFILE_INVALID';
    throw error;
  }

  const authPath = required(env.PV_AUTH_CONFIG_PATH, 'PV_AUTH_CONFIG_PATH');
  const declarationPath = required(
    env.PV_RESPONSIBLE_DECLARATION_PATH,
    'PV_RESPONSIBLE_DECLARATION_PATH',
  );
  const backupReportPath = required(
    env.PV_KAIROSETH_BACKUP_REPORT_PATH,
    'PV_KAIROSETH_BACKUP_REPORT_PATH',
  );
  const client = mongoClient(uri);
  await client.connect();

  try {
    const database = client.db(databaseName);
    await verifyKairosethMongoIndexes(database);

    const fiscalRecordStore = createMongoKairosethFiscalRecordStore({ database });
    const integrationDataStore = createMongoKairosethIntegrationStore({ database });
    const importSessionStore = createMongoKairosethImportSessionStore({ database });
    const importBatchStore = createMongoKairosethImportBatchStore({ database });
    const localAgentRegistryStore = createMongoKairosethLocalAgentRegistryStore({ database });
    const onboardingProfileStore = createMongoKairosethOnboardingProfileStore({ database });
    const integrationProfileStore = createMongoKairosethIntegrationProfileStore({ database });
    const aeatOutboxStore = createMongoKairosethAeatOutboxStore({ database });
    const kairosethAuthProvider = createMongoKairosethFiscalAuthProvider({ database });

    const deliveryQueue = createAeatDeliveryQueue({ outbox: aeatOutboxStore });
    const sif = await sifConfig(env);
    const environment = aeatEnvironment(env);
    const tls = await loadRuntimeAeatTls(env);
    const adapter = new AeatVerifactuAdapter({
      sif,
      environment,
      allowProduction: environment === 'production' && env.PV_AEAT_ALLOW_PRODUCTION === 'YES',
      transport: createHttpsMtlsTransport({ tls }),
    });
    const worker = new AeatOutboxWorker({
      adapter,
      outbox: aeatOutboxStore,
      leaseMs: integer(env.PV_AEAT_LEASE_MS, 30_000, 'PV_AEAT_LEASE_MS', 5_000, 300_000),
      maxAttempts: integer(env.PV_AEAT_MAX_ATTEMPTS, 5, 'PV_AEAT_MAX_ATTEMPTS', 1, 20),
    });
    const dispatchLoop = createAeatDispatchLoop({
      worker,
      intervalMs: integer(
        env.PV_AEAT_DISPATCH_INTERVAL_MS,
        1000,
        'PV_AEAT_DISPATCH_INTERVAL_MS',
        250,
        60_000,
      ),
      batchSize: integer(
        env.PV_AEAT_DISPATCH_BATCH_SIZE,
        25,
        'PV_AEAT_DISPATCH_BATCH_SIZE',
        1,
        100,
      ),
    });

    const resolveIntegrationSecretReference = await loadPrivateSecretResolver(
      env.PV_INTEGRATION_SECRETS_PATH,
    );
    const runtime = createPuenteRuntime({
      persistenceMode: 'kairoseth',
      authConfig: loadAuthConfig(authPath),
      integrationConfig: loadIntegrationConfig(env.PV_INTEGRATION_CONFIG_PATH),
      sif,
      presentationEnvironment: environment,
      responsibleDeclarationPath: declarationPath,
      fiscalRecordStore,
      integrationDataStore,
      importSessionStore,
      importBatchStore,
      localAgentRegistryStore,
      onboardingProfileStore,
      integrationProfileStore,
      aeatOutboxStore,
      enqueueDelivery: deliveryQueue.enqueue,
      resolveDelivery: deliveryQueue.resolve,
      resolveIntegrationSecretReference,
      kairosethAuthProvider,
      persistenceHealthcheck: () => fiscalRecordStore.healthcheck(),
      backupStatusProvider: createKairosethBackupStatusProvider({
        reportPath: backupReportPath,
      }),
    });

    return Object.freeze({
      client,
      database,
      runtime,
      dispatchLoop,
      environment,
      databaseName,
    });
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    throw Object.assign(
      new Error('Kairoseth production entrypoint requires NODE_ENV=production'),
      { code: 'VF_KAIROSETH_NODE_ENV_REQUIRED' },
    );
  }

  const service = await buildKairosethProductionService(process.env);
  const host = String(process.env.PV_HOST ?? '127.0.0.1').trim();
  const port = integer(process.env.PV_PORT ?? process.env.PORT, 8787, 'PV_PORT', 1, 65535);
  let closing = false;

  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(JSON.stringify({
      service: 'kairoseth-fiscal',
      status: 'shutting_down',
      signal,
    }));
    try {
      await service.dispatchLoop.stop();
      await service.runtime.close();
      await service.client.close();
      process.exitCode = 0;
    } catch (error) {
      console.error(JSON.stringify({
        service: 'kairoseth-fiscal',
        status: 'shutdown_failed',
        code: error?.code ?? 'VF_KAIROSETH_SHUTDOWN_FAILED',
        message: error?.message ?? 'Shutdown failed',
      }));
      process.exitCode = 1;
    }
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });

  await new Promise((resolveListen, rejectListen) => {
    service.runtime.server.once('error', rejectListen);
    service.runtime.server.listen(port, host, () => {
      service.runtime.server.off('error', rejectListen);
      resolveListen();
    });
  });
  await service.dispatchLoop.start();

  console.log(JSON.stringify({
    service: 'kairoseth-fiscal',
    status: 'listening',
    host,
    port,
    persistence: 'kairoseth-mongodb',
    database: service.databaseName,
    aeatEnvironment: service.environment,
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({
      service: 'kairoseth-fiscal',
      status: 'failed',
      code: error?.code ?? 'VF_KAIROSETH_STARTUP_FAILED',
      message: error?.message ?? 'Startup failed',
      field: error?.field ?? null,
    }));
    process.exitCode = 1;
  });
}
