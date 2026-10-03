import { readFileSync } from 'node:fs';
import { validateUniversalAdapterManifest } from '../../packages/connector-contract-suite/src/adapter-manifest.mjs';

const path = 'connectors/reference/adapter-manifest.json';
const input = JSON.parse(readFileSync(path, 'utf8'));
const manifest = validateUniversalAdapterManifest(input);

const failures = [];
for (const capability of ['preflight', 'issue', 'status', 'sync']) {
  if (manifest.capabilities[capability] !== true) {
    failures.push({ code: 'ADAPTER_REQUIRED_CAPABILITY_MISSING', capability });
  }
}
for (const invariant of ['secrets_server_side', 'aeat_certificate_server_side', 'tenant_server_authoritative']) {
  if (manifest.security[invariant] !== true) {
    failures.push({ code: 'ADAPTER_SECURITY_INVARIANT_MISSING', invariant });
  }
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    check: 'universal-adapter-contract-v1',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'universal-adapter-contract-v1',
  manifest_id: manifest.id,
  channel: manifest.channel,
  transport: manifest.transport,
  mapping: manifest.mapping,
  capability_first: true,
}, null, 2));
