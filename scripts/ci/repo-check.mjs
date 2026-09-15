import { existsSync, readFileSync } from 'node:fs';

const requiredPaths = [
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'docs/architecture.md',
  'docs/integration-strategy.md',
  'docs/onboarding-integration.md',
  'docs/engineering-rules.md',
  'docs/aeat-test-adapter-v1.md',
  'docs/universal-integration-kit-v1.md',
  'docs/mapping-assistant-v1.md',
  'docs/adr/0001-verifactu-only-mvp.md',
  'docs/adr/0002-chameleon-integration.md',
  'docs/adr/0003-defer-external-gates-with-release-block.md',
  'apps/api/README.md',
  'packages/contracts/README.md',
  'packages/core/README.md',
  'packages/diagnostics/README.md',
  'packages/aeat-adapter/README.md',
  'packages/sdk/README.md',
  'connectors/reference/README.md',
  'connectors/file-import/README.md',
  'connectors/file-import/src/xlsx.mjs',
  'packages/core/src/mapping-assistant.mjs'
];

const failures = [];

for (const path of requiredPaths) {
  if (!existsSync(path)) failures.push({ code: 'REPO_REQUIRED_PATH_MISSING', path });
}

try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg?.engines?.node !== '>=22') {
    failures.push({ code: 'REPO_NODE_CONTRACT_INVALID', expected: '>=22', received: pkg?.engines?.node ?? null });
  }
} catch (error) {
  failures.push({ code: 'REPO_PACKAGE_JSON_INVALID', message: error.message });
}

const readme = existsSync('README.md') ? readFileSync('README.md', 'utf8') : '';
if (!readme.includes('Principio Camaleón')) {
  failures.push({ code: 'REPO_PRODUCT_PRINCIPLE_MISSING', expected: 'Principio Camaleón in README.md' });
}

if (failures.length > 0) {
  const diagnostic = {
    schema_version: 1,
    pipeline: 'GitHub Actions',
    job: 'validation',
    step: 'repository-contract-check',
    command: 'node scripts/ci/repo-check.mjs',
    exit_code: 1,
    primary_error: failures[0].code,
    failures,
    root_cause_status: 'confirmed'
  };
  console.error(JSON.stringify(diagnostic, null, 2));
  console.error(`::error title=${failures[0].code}::Repository foundation contract failed; inspect structured diagnostic above.`);
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'repository-foundation',
  required_paths: requiredPaths.length
}, null, 2));
