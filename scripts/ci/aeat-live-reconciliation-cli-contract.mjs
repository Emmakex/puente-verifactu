import { existsSync, readFileSync } from 'node:fs';

const paths = {
  cli: 'scripts/aeat/live-reconciliation.mjs',
  lib: 'scripts/aeat/live-reconciliation-lib.mjs',
  tests: 'scripts/aeat/test/live-reconciliation-cli.test.mjs',
  reconciler: 'packages/aeat-adapter/src/reconciliation.mjs',
  package: 'package.json',
  workflow: '.github/workflows/ci.yml',
};

const failures = [];
for (const [name, path] of Object.entries(paths)) {
  if (!existsSync(path)) failures.push({ code: 'AEAT_LIVE_RECONCILIATION_PATH_MISSING', name, path });
}

const cli = existsSync(paths.cli) ? readFileSync(paths.cli, 'utf8') : '';
const lib = existsSync(paths.lib) ? readFileSync(paths.lib, 'utf8') : '';
const tests = existsSync(paths.tests) ? readFileSync(paths.tests, 'utf8') : '';
const reconciler = existsSync(paths.reconciler) ? readFileSync(paths.reconciler, 'utf8') : '';
const pkg = existsSync(paths.package) ? JSON.parse(readFileSync(paths.package, 'utf8')) : { scripts: {} };
const workflow = existsSync(paths.workflow) ? readFileSync(paths.workflow, 'utf8') : '';

for (const marker of [
  'readOnly: true',
  'AEAT_RECONCILIATION_APPLY',
  "environment: 'test'",
  'apply: options.apply',
  'jobIdSha256',
  'entryRecordHashFingerprints',
  'fiscalHashFingerprint',
  "flag: 'wx'",
  'mode: 0o600',
  'shouldReissue: false',
]) {
  if (!lib.includes(marker)) failures.push({ code: 'AEAT_LIVE_RECONCILIATION_SAFETY_MARKER_MISSING', marker });
}
if (lib.includes('entryRecordHashes')) {
  failures.push({ code: 'AEAT_LIVE_RECONCILIATION_RAW_FISCAL_HASH_EVIDENCE_FORBIDDEN' });
}

if (/\.submit\s*\(/.test(lib) || /\.submit\s*\(/.test(cli)) {
  failures.push({ code: 'AEAT_LIVE_RECONCILIATION_MUST_NOT_SUBMIT' });
}
if (/environment\s*:\s*['"]production['"]/.test(lib) || /allowProduction\s*:\s*true/.test(lib)) {
  failures.push({ code: 'AEAT_LIVE_RECONCILIATION_PRODUCTION_FORBIDDEN' });
}
if (/action\s*:\s*['"]retry['"]/.test(lib)) {
  failures.push({ code: 'AEAT_LIVE_RECONCILIATION_AUTO_RETRY_FORBIDDEN' });
}
if (!reconciler.includes('async inspect(jobId, { apply = true } = {})')) {
  failures.push({ code: 'AEAT_LIVE_RECONCILIATION_INSPECT_ONLY_MODE_MISSING' });
}
if (!reconciler.includes('if (!allReceived || !apply)')) {
  failures.push({ code: 'AEAT_LIVE_RECONCILIATION_APPLY_BOUNDARY_MISSING' });
}

for (const marker of [
  'inspect mode uses official query and leaves SQLite job quarantined',
  'apply mode completes only after exact AEAT match and double guard',
  'SinDatos in apply mode stays quarantined and never becomes retry-safe',
  'evidence is non-overwriting, mode 0600 and omits raw fiscal hash',
  'invalid fiscal record hash fails closed when sanitizing live reconciliation evidence',
  'missing database fails before credentials or network are touched',
]) {
  if (!tests.includes(marker)) failures.push({ code: 'AEAT_LIVE_RECONCILIATION_TEST_MISSING', marker });
}

if (pkg.scripts?.['aeat:reconcile'] !== 'node scripts/aeat/live-reconciliation.mjs') {
  failures.push({ code: 'AEAT_LIVE_RECONCILIATION_COMMAND_MISSING' });
}
if (pkg.scripts?.['aeat:reconcile:smoke'] !== 'node --test scripts/aeat/test/live-reconciliation-cli.test.mjs') {
  failures.push({ code: 'AEAT_LIVE_RECONCILIATION_SMOKE_COMMAND_MISSING' });
}
if (!workflow.includes('AEAT live reconciliation CLI smoke') || !workflow.includes('npm run aeat:reconcile:smoke')) {
  failures.push({ code: 'AEAT_LIVE_RECONCILIATION_WORKFLOW_GATE_MISSING' });
}

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    check: 'aeat-live-reconciliation-cli-contract',
    status: 'failed',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  check: 'aeat-live-reconciliation-cli-contract',
  status: 'ok',
  invariants: {
    inspect_read_only: true,
    double_guard_for_apply: true,
    test_environment_only: true,
    no_submit_path: true,
    no_automatic_retry: true,
    raw_fiscal_hash_omitted: true,
    sanitized_evidence: true,
  },
}, null, 2));
