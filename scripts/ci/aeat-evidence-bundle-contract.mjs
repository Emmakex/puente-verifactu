import { existsSync, readFileSync } from 'node:fs';

const failures = [];
const requiredPaths = [
  'scripts/aeat/evidence-bundle-verifier-lib.mjs',
  'scripts/aeat/verify-evidence-bundle.mjs',
  'scripts/aeat/test/evidence-bundle-verifier.test.mjs',
];

for (const path of requiredPaths) {
  if (!existsSync(path)) failures.push({ code: 'AEAT_EVIDENCE_BUNDLE_PATH_MISSING', path });
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg?.scripts?.['aeat:evidence:verify'] !== 'node scripts/aeat/verify-evidence-bundle.mjs') {
  failures.push({ code: 'AEAT_EVIDENCE_BUNDLE_COMMAND_MISSING' });
}
if (pkg?.scripts?.['aeat:evidence:smoke'] !== 'node --test scripts/aeat/test/evidence-bundle-verifier.test.mjs') {
  failures.push({ code: 'AEAT_EVIDENCE_BUNDLE_SMOKE_MISSING' });
}

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
if (!workflow.includes('npm run aeat:evidence:smoke')) {
  failures.push({ code: 'AEAT_EVIDENCE_BUNDLE_CI_MISSING' });
}

const verifier = existsSync('scripts/aeat/evidence-bundle-verifier-lib.mjs')
  ? readFileSync('scripts/aeat/evidence-bundle-verifier-lib.mjs', 'utf8')
  : '';
for (const marker of [
  "status: 'partial'",
  "remainingExternalEvidence: ['reconciliation']",
  'releaseUnblocked: false',
  'AEAT_ARTIFACTS',
  'VF_AEAT_EVIDENCE_RAW_SENSITIVE_FIELD',
]) {
  if (!verifier.includes(marker)) failures.push({ code: 'AEAT_EVIDENCE_BUNDLE_SAFETY_MARKER_MISSING', marker });
}

for (const forbidden of ['update_issue', 'release_candidate', 'AEAT_LIVE_SEND']) {
  if (verifier.includes(forbidden)) {
    failures.push({ code: 'AEAT_EVIDENCE_BUNDLE_SCOPE_VIOLATION', forbidden });
  }
}

const runbook = readFileSync('docs/aeat-live-gate.md', 'utf8');
for (const marker of ['npm run aeat:evidence:verify', 'remainingExternalEvidence', 'reconciliation']) {
  if (!runbook.includes(marker)) failures.push({ code: 'AEAT_EVIDENCE_BUNDLE_RUNBOOK_INCOMPLETE', marker });
}

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    check: 'aeat-evidence-bundle-contract',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'aeat-evidence-bundle-contract',
  release_unblocked: false,
}, null, 2));
