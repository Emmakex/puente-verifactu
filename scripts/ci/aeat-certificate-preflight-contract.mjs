import { existsSync, readFileSync } from 'node:fs';

const failures = [];
const requiredPaths = [
  'scripts/aeat/certificate-check.mjs',
  'scripts/aeat/certificate-preflight-lib.mjs',
  'scripts/aeat/test/certificate-preflight.test.mjs',
];

for (const path of requiredPaths) {
  if (!existsSync(path)) failures.push({ code: 'AEAT_CERT_PREFLIGHT_PATH_MISSING', path });
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg?.scripts?.['aeat:cert:check'] !== 'node scripts/aeat/certificate-check.mjs') {
  failures.push({ code: 'AEAT_CERT_PREFLIGHT_COMMAND_MISSING' });
}
if (pkg?.scripts?.['aeat:cert:smoke'] !== 'node --test scripts/aeat/test/certificate-preflight.test.mjs') {
  failures.push({ code: 'AEAT_CERT_PREFLIGHT_SMOKE_MISSING' });
}

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
if (!workflow.includes('npm run aeat:cert:smoke')) {
  failures.push({ code: 'AEAT_CERT_PREFLIGHT_CI_MISSING' });
}

const certificateCheck = existsSync('scripts/aeat/certificate-check.mjs')
  ? readFileSync('scripts/aeat/certificate-check.mjs', 'utf8')
  : '';
for (const forbidden of ['createHttpsMtlsTransport', 'AeatVerifactuAdapter', 'node:https', 'node:http']) {
  if (certificateCheck.includes(forbidden)) {
    failures.push({ code: 'AEAT_CERT_PREFLIGHT_NETWORK_COUPLING', forbidden });
  }
}

const liveGate = readFileSync('scripts/aeat/live-gate.mjs', 'utf8');
if (!liveGate.includes("loadPfxCredentials(process.env)")) {
  failures.push({ code: 'AEAT_CERT_PREFLIGHT_NOT_SHARED_WITH_LIVE_GATE' });
}

const runbook = readFileSync('docs/aeat-live-gate.md', 'utf8');
for (const marker of ['npm run aeat:cert:check', 'networkUsed: false', 'no demuestra']) {
  if (!runbook.includes(marker)) failures.push({ code: 'AEAT_CERT_PREFLIGHT_RUNBOOK_INCOMPLETE', marker });
}

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    check: 'aeat-certificate-preflight-contract',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'aeat-certificate-preflight-contract',
  offline: true,
}, null, 2));
