import { resolve } from 'node:path';
import { loadAuthConfig } from './auth.mjs';
import { loadIntegrationConfig } from './integration-config.mjs';
import { createPuenteRuntime } from './runtime.mjs';

function integerEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new TypeError(`${name} must be a valid port`);
  return value;
}

const host = process.env.PV_HOST?.trim() || '127.0.0.1';
const port = integerEnv('PV_PORT', 8787);
const databasePath = resolve(process.env.PV_DATABASE_PATH?.trim() || './runtime-data/puente.sqlite');
const authConfig = loadAuthConfig(process.env.PV_AUTH_CONFIG_PATH);
const integrationConfig = loadIntegrationConfig(process.env.PV_INTEGRATION_CONFIG_PATH);

const runtime = createPuenteRuntime({
  databasePath,
  authConfig,
  integrationConfig,
  sif: {
    systemId: process.env.PV_SIF_SYSTEM_ID,
    installationNumber: process.env.PV_SIF_INSTALLATION_NUMBER,
    timeZone: process.env.PV_TIME_ZONE?.trim() || 'Europe/Madrid',
  },
});

await new Promise((resolveListen, reject) => {
  runtime.server.once('error', reject);
  runtime.server.listen(port, host, () => {
    runtime.server.off('error', reject);
    resolveListen();
  });
});

console.log(JSON.stringify({
  event: 'puente-verifactu.started',
  host,
  port,
  databasePath,
  mode: 'single-node-sqlite',
  aeatLiveSend: false,
}));

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: 'puente-verifactu.stopping', signal }));
  try {
    await runtime.close();
    process.exitCode = 0;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'puente-verifactu.shutdown_failed',
      error: error.message,
      code: error.code ?? null,
    }));
    process.exitCode = 1;
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
