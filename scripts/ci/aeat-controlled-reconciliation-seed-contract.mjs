import { existsSync, readFileSync } from 'node:fs';

const paths = {
  liveGate: 'scripts/aeat/live-gate.mjs',
  liveGateLib: 'scripts/aeat/live-gate-lib.mjs',
  seedLib: 'scripts/aeat/reconciliation-seed-lib.mjs',
  tests: 'scripts/aeat/test/reconciliation-seed.test.mjs',
  package: 'package.json',
  workflow: '.github/workflows/ci.yml',
};

const failures = [];
for (const [name, path] of Object.entries(paths)) {
  if (!existsSync(path)) failures.push({ code: 'AEAT_RECONCILIATION_SEED_PATH_MISSING', name, path });
}

const liveGate = existsSync(paths.liveGate) ? readFileSync(paths.liveGate, 'utf8') : '';
const liveGateLib = existsSync(paths.liveGateLib) ? readFileSync(paths.liveGateLib, 'utf8') : '';
const seedLib = existsSync(paths.seedLib) ? readFileSync(paths.seedLib, 'utf8') : '';
const tests = existsSync(paths.tests) ? readFileSync(paths.tests, 'utf8') : '';
const pkg = existsSync(paths.package) ? JSON.parse(readFileSync(paths.package, 'utf8')) : { scripts: {} };
const workflow = existsSync(paths.workflow) ? readFileSync(paths.workflow, 'utf8') : '';

for (const marker of [
  'AEAT_RECONCILIATION_SEED',
  '--reconciliation-seed-db',
  '--reconciliation-seed-output',
  "expectedStatus !== 'accepted'",
  'VF_AEAT_RECONCILIATION_SEED_SEND_REQUIRED',
  'VF_AEAT_RECONCILIATION_SEED_EXPECT_ACCEPTED',
  'VF_AEAT_RECONCILIATION_SEED_SOURCE_COMMIT_REQUIRED',
]) {
  if (!liveGateLib.includes(marker)) failures.push({ code: 'AEAT_RECONCILIATION_SEED_GUARD_MISSING', marker });
}

for (const marker of [
  "state: 'reconciliation_required'",
  "reason: 'controlled_live_gate_reconciliation_seed'",
  "mode: 0o600",
  "flag: 'w'",
  'submitCountAdded: 0',
  'shouldReissue: false',
  'jobIdSha256',
]) {
  if (!seedLib.includes(marker)) failures.push({ code: 'AEAT_RECONCILIATION_SEED_SAFETY_MARKER_MISSING', marker });
}

if (/\.submit\s*\(/.test(seedLib)) failures.push({ code: 'AEAT_RECONCILIATION_SEED_MUST_NOT_SUBMIT' });
if (/environment\s*:\s*['"]production['"]/.test(seedLib) || /allowProduction\s*:\s*true/.test(seedLib)) {
  failures.push({ code: 'AEAT_RECONCILIATION_SEED_PRODUCTION_FORBIDDEN' });
}
if (/action\s*:\s*['"]retry['"]/.test(seedLib)) failures.push({ code: 'AEAT_RECONCILIATION_SEED_AUTO_RETRY_FORBIDDEN' });

const submitCalls = liveGate.match(/\.submit\s*\(/g)?.length ?? 0;
if (submitCalls !== 1) failures.push({ code: 'AEAT_RECONCILIATION_SEED_LIVE_GATE_SUBMIT_COUNT_INVALID', submitCalls });

const reservationIndex = liveGate.indexOf('assertControlledReconciliationSeedDestinations');
const credentialIndex = liveGate.indexOf('loadPfxCredentials(process.env)');
const expectedStatusIndex = liveGate.indexOf('if (options.expectedStatus');
const seedCreateIndex = liveGate.indexOf('createControlledReconciliationSeed({');
if (reservationIndex < 0 || credentialIndex < 0 || reservationIndex >= credentialIndex) {
  failures.push({ code: 'AEAT_RECONCILIATION_SEED_DESTINATIONS_NOT_RESERVED_BEFORE_CREDENTIALS' });
}
if (expectedStatusIndex < 0 || seedCreateIndex < 0 || expectedStatusIndex >= seedCreateIndex) {
  failures.push({ code: 'AEAT_RECONCILIATION_SEED_NOT_CREATED_AFTER_ACCEPTANCE_CHECK' });
}

for (const marker of [
  'controlled seed creates private SQLite quarantine and private operator file',
  'seed rejects non-accepted result before creating private files',
  'destination reservation is exclusive and never overwrites existing data or leaks its path',
  'reservations can be released before certificate/network use',
]) {
  if (!tests.includes(marker)) failures.push({ code: 'AEAT_RECONCILIATION_SEED_TEST_MISSING', marker });
}

for (const forbidden of ['databasePathSha256', 'operatorOutputPathSha256']) {
  if (seedLib.includes(forbidden)) failures.push({ code: 'AEAT_RECONCILIATION_SEED_PUBLIC_PATH_METADATA_FORBIDDEN', marker: forbidden });
}

if (pkg.scripts?.['aeat:seed:smoke'] !== 'node --test scripts/aeat/test/reconciliation-seed.test.mjs scripts/aeat/test/live-gate.test.mjs') {
  failures.push({ code: 'AEAT_RECONCILIATION_SEED_SMOKE_COMMAND_MISSING' });
}
if (!workflow.includes('AEAT controlled reconciliation seed smoke') || !workflow.includes('npm run aeat:seed:smoke')) {
  failures.push({ code: 'AEAT_RECONCILIATION_SEED_WORKFLOW_GATE_MISSING' });
}

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    check: 'aeat-controlled-reconciliation-seed-contract',
    status: 'failed',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  check: 'aeat-controlled-reconciliation-seed-contract',
  status: 'ok',
  invariants: {
    accepted_send_only: true,
    destinations_reserved_before_credentials: true,
    private_files_0600: true,
    one_live_submit_only: true,
    seed_adds_no_submit: true,
    no_automatic_retry: true,
    public_paths_hidden: true,
  },
}, null, 2));
