import { createMongoKairosethCustomerActivationStore } from '../../../packages/kairoseth-control-plane/src/index.mjs';
import { KairosethCustomerActivationService } from './customer-activation.mjs';
import { buildKairosethProductionService } from './kairoseth-main.mjs';

function integer(value, fallback, name, min, max) {
  const candidate = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return candidate;
}

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    throw Object.assign(
      new Error('Kairoseth production entrypoint requires NODE_ENV=production'),
      { code: 'VF_KAIROSETH_NODE_ENV_REQUIRED' },
    );
  }

  const service = await buildKairosethProductionService(process.env);
  const activationStore = createMongoKairosethCustomerActivationStore({
    database: service.database,
  });
  const customerActivations = new KairosethCustomerActivationService({
    store: activationStore,
    integrationProfiles: service.runtime.integrationProfiles,
    environment: service.environment,
    endpoint: String(process.env.PV_PUBLIC_BASE_URL ?? 'https://kairoseth.com/api/fiscal').replace(/\/+$/, ''),
  });
  service.runtime.server.setCustomerActivationExchange(
    (input) => customerActivations.exchange(input),
  );

  const host = String(process.env.PV_HOST ?? '0.0.0.0').trim();
  const port = integer(process.env.PV_PORT ?? process.env.PORT, 3000, 'PV_PORT', 1, 65535);
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
    customerActivation: 'kfs2-one-time',
  }));
}

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
