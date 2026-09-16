import { existsSync, readFileSync } from 'node:fs';

const files = {
  liveGate: 'scripts/aeat/live-gate.mjs',
  liveGateLib: 'scripts/aeat/live-gate-lib.mjs',
  tests: 'scripts/aeat/test/controlled-rejection-profile.test.mjs',
  package: 'package.json',
  workflow: '.github/workflows/ci.yml',
};

const failures = [];
for (const [name, path] of Object.entries(files)) {
  if (!existsSync(path)) failures.push({ code: 'AEAT_CONTROLLED_REJECTION_PATH_MISSING', name, path });
}

const liveGate = existsSync(files.liveGate) ? readFileSync(files.liveGate, 'utf8') : '';
const liveGateLib = existsSync(files.liveGateLib) ? readFileSync(files.liveGateLib, 'utf8') : '';
const tests = existsSync(files.tests) ? readFileSync(files.tests, 'utf8') : '';
const pkg = existsSync(files.package) ? JSON.parse(readFileSync(files.package, 'utf8')) : { scripts: {} };
const workflow = existsSync(files.workflow) ? readFileSync(files.workflow, 'utf8') : '';

for (const marker of [
  "'future-issue-date'",
  'AEAT_CONTROLLED_REJECTION',
  'VF_AEAT_GATE_REJECTION_SEND_REQUIRED',
  'VF_AEAT_GATE_REJECTION_EXPECT_REJECTED',
  'VF_AEAT_GATE_REJECTION_GUARD',
  'VF_AEAT_GATE_REJECTION_PROFILE_DATE_CONFLICT',
  "expectedStatus !== 'rejected'",
  'controlledRejectionProfile',
  'nextIsoDate(localToday)',
]) {
  if (!liveGateLib.includes(marker)) failures.push({ code: 'AEAT_CONTROLLED_REJECTION_GUARD_MISSING', marker });
}

if (!liveGate.includes('rejectionProfile: options.rejectionProfile')) {
  failures.push({ code: 'AEAT_CONTROLLED_REJECTION_NOT_WIRED_TO_FIXTURE' });
}
if ((liveGate.match(/\.submit\s*\(/g)?.length ?? 0) !== 1) {
  failures.push({ code: 'AEAT_CONTROLLED_REJECTION_SUBMIT_COUNT_INVALID' });
}
if (/environment\s*:\s*['"]production['"]/.test(liveGate) || /allowProduction\s*:\s*true/.test(liveGate)) {
  failures.push({ code: 'AEAT_CONTROLLED_REJECTION_PRODUCTION_FORBIDDEN' });
}

for (const marker of [
  'controlled rejection profile requires a real send',
  'controlled rejection profile requires rejected expectation and explicit guard',
  'future issue date profile cannot be mixed with a manually supplied issue date',
  'future issue date profile generates tomorrow in the configured local calendar',
  'controlled rejection evidence summary identifies the profile without exposing raw XML',
]) {
  if (!tests.includes(marker)) failures.push({ code: 'AEAT_CONTROLLED_REJECTION_TEST_MISSING', marker });
}

if (pkg.scripts?.['aeat:rejection:smoke'] !== 'node --test scripts/aeat/test/controlled-rejection-profile.test.mjs') {
  failures.push({ code: 'AEAT_CONTROLLED_REJECTION_SMOKE_COMMAND_MISSING' });
}
if (!workflow.includes('AEAT controlled rejection profile smoke') || !workflow.includes('npm run aeat:rejection:smoke')) {
  failures.push({ code: 'AEAT_CONTROLLED_REJECTION_WORKFLOW_GATE_MISSING' });
}

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    check: 'aeat-controlled-rejection-profile-contract',
    status: 'failed',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  check: 'aeat-controlled-rejection-profile-contract',
  status: 'ok',
  profile: 'future-issue-date',
  official_rule: 'FechaExpedicionFactura must not be later than the current date',
  validations_document_version: '1.2.2',
  invariants: {
    test_environment_only: true,
    explicit_send: true,
    explicit_rejected_expectation: true,
    explicit_guard: true,
    one_submit_only: true,
    no_production_override: true,
  },
}, null, 2));
