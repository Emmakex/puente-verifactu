import { existsSync, readFileSync } from 'node:fs';

const paths = {
  verifier: 'scripts/aeat/final-gate-evidence-lib.mjs',
  cli: 'scripts/aeat/verify-final-gate-evidence.mjs',
  tests: 'scripts/aeat/test/final-gate-evidence.test.mjs',
  reconciliation: 'scripts/aeat/live-reconciliation-lib.mjs',
  package: 'package.json',
  workflow: '.github/workflows/ci.yml',
  runbook: 'docs/aeat-live-gate.md',
};

const failures = [];
for (const [name, path] of Object.entries(paths)) {
  if (!existsSync(path)) failures.push({ code: 'AEAT_FINAL_GATE_EVIDENCE_PATH_MISSING', name, path });
}

const verifier = existsSync(paths.verifier) ? readFileSync(paths.verifier, 'utf8') : '';
const reconciliation = existsSync(paths.reconciliation) ? readFileSync(paths.reconciliation, 'utf8') : '';
const tests = existsSync(paths.tests) ? readFileSync(paths.tests, 'utf8') : '';
const pkg = existsSync(paths.package) ? JSON.parse(readFileSync(paths.package, 'utf8')) : { scripts: {} };
const workflow = existsSync(paths.workflow) ? readFileSync(paths.workflow, 'utf8') : '';
const runbook = existsSync(paths.runbook) ? readFileSync(paths.runbook, 'utf8') : '';

for (const marker of [
  "status: 'external_gate_evidence_complete'",
  'releaseUnblocked: false',
  'automaticIssueClosure: false',
  "nextAction: 'review_issue_6_and_release_candidate_procedure'",
  "reconciliation.mode !== 'apply'",
  "reconciliation.beforeState !== 'reconciliation_required'",
  "reconciliation.afterState !== 'completed'",
  'reconciliation?.assessment?.allReceived !== true',
  'reconciliation?.assessment?.applied !== true',
  'reconciliation?.assessment?.shouldReissue !== false',
  'VF_AEAT_FINAL_EVIDENCE_RECORD_HASH_MISMATCH',
  'verifyAeatEvidenceBundle',
]) {
  if (!verifier.includes(marker)) failures.push({ code: 'AEAT_FINAL_GATE_EVIDENCE_SAFETY_MARKER_MISSING', marker });
}

for (const marker of ['entryRecordHashes', 'beforeJob.payload.entries.map']) {
  if (!reconciliation.includes(marker)) failures.push({ code: 'AEAT_FINAL_GATE_RECONCILIATION_BINDING_MISSING', marker });
}

for (const forbidden of ['update_issue', 'close_issue', 'release_candidate', 'AEAT_LIVE_SEND']) {
  if (verifier.includes(forbidden)) failures.push({ code: 'AEAT_FINAL_GATE_EVIDENCE_SCOPE_VIOLATION', forbidden });
}

for (const marker of [
  'complete accepted rejected and applied reconciliation evidence verifies without unblocking release',
  'final evidence cryptographically binds reconciliation to the accepted fiscal record',
  'inspect-only reconciliation cannot satisfy the final external gate evidence',
  'raw sensitive reconciliation fields fail closed',
]) {
  if (!tests.includes(marker)) failures.push({ code: 'AEAT_FINAL_GATE_EVIDENCE_TEST_MISSING', marker });
}

if (pkg.scripts?.['aeat:final-evidence:verify'] !== 'node scripts/aeat/verify-final-gate-evidence.mjs') {
  failures.push({ code: 'AEAT_FINAL_GATE_EVIDENCE_COMMAND_MISSING' });
}
if (pkg.scripts?.['aeat:final-evidence:smoke'] !== 'node --test scripts/aeat/test/final-gate-evidence.test.mjs') {
  failures.push({ code: 'AEAT_FINAL_GATE_EVIDENCE_SMOKE_MISSING' });
}
if (!String(pkg.scripts?.check ?? '').includes('scripts/ci/aeat-final-gate-evidence-contract.mjs')) {
  failures.push({ code: 'AEAT_FINAL_GATE_EVIDENCE_CHECK_CHAIN_MISSING' });
}
if (!workflow.includes('AEAT final gate evidence verifier smoke') || !workflow.includes('npm run aeat:final-evidence:smoke')) {
  failures.push({ code: 'AEAT_FINAL_GATE_EVIDENCE_WORKFLOW_GATE_MISSING' });
}
for (const marker of ['npm run aeat:final-evidence:verify', 'external_gate_evidence_complete', 'releaseUnblocked']) {
  if (!runbook.includes(marker)) failures.push({ code: 'AEAT_FINAL_GATE_EVIDENCE_RUNBOOK_INCOMPLETE', marker });
}

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    check: 'aeat-final-gate-evidence-contract',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'aeat-final-gate-evidence-contract',
  invariants: {
    accepted_rejected_reconciliation_required: true,
    reconciliation_apply_required: true,
    fiscal_record_hash_bound: true,
    should_reissue_false: true,
    release_unblocked_false: true,
    automatic_issue_closure_false: true,
  },
}, null, 2));
