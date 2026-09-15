import { existsSync, readFileSync } from 'node:fs';

const requiredPaths = [
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  '.env.example',
  '.github/workflows/ci.yml',
  'docs/architecture.md',
  'docs/integration-strategy.md',
  'docs/onboarding-integration.md',
  'docs/engineering-rules.md',
  'docs/aeat-test-adapter-v1.md',
  'docs/universal-integration-kit-v1.md',
  'docs/mapping-assistant-v1.md',
  'docs/canonical-core-v1.md',
  'docs/woocommerce-compatibility.md',
  'docs/production-readiness.md',
  'docs/adr/0001-verifactu-only-mvp.md',
  'docs/adr/0002-chameleon-integration.md',
  'docs/adr/0003-defer-external-gates-with-release-block.md',
  'apps/api/README.md',
  'apps/onboarding/README.md',
  'apps/onboarding/index.html',
  'apps/onboarding/app.js',
  'apps/onboarding/src/model.mjs',
  'apps/server/README.md',
  'apps/server/src/main.mjs',
  'apps/server/src/runtime.mjs',
  'apps/server/src/auth.mjs',
  'packages/contracts/README.md',
  'packages/core/README.md',
  'packages/diagnostics/README.md',
  'packages/aeat-adapter/README.md',
  'packages/aeat-adapter/src/outbox.mjs',
  'packages/aeat-adapter/test/aeat-adapter.test.mjs',
  'packages/sdk/README.md',
  'packages/sqlite-store/README.md',
  'packages/sqlite-store/src/index.mjs',
  'packages/sqlite-store/src/backup.mjs',
  'packages/sqlite-store/src/aeat-outbox.mjs',
  'packages/sqlite-store/test/backup-restore.test.mjs',
  'packages/sqlite-store/test/aeat-outbox.test.mjs',
  'packages/connector-contract-suite/README.md',
  'packages/connector-contract-suite/src/suite.mjs',
  'connectors/reference/README.md',
  'connectors/reference/contract.mjs',
  'connectors/file-import/README.md',
  'connectors/file-import/src/xlsx.mjs',
  'connectors/woocommerce/README.md',
  'connectors/woocommerce/readme.txt',
  'connectors/woocommerce/puente-verifactu-woocommerce.php',
  'connectors/woocommerce/includes/class-pv-woo-refund-payload.php',
  'connectors/woocommerce/includes/class-pv-woo-admin-status.php',
  'connectors/woocommerce/examples/mapping-profile.json',
  'connectors/woocommerce/examples/refund-mapping-profile.json',
  'connectors/woocommerce/languages/puente-verifactu-woocommerce-es_ES.po',
  'connectors/woocommerce/languages/puente-verifactu-woocommerce-es_ES.mo',
  'connectors/prestashop/README.md',
  'connectors/prestashop/puenteverifactu.php',
  'connectors/prestashop/classes/PVFPrestaShopSecretStore.php',
  'connectors/prestashop/classes/PVFPrestaShopClient.php',
  'connectors/prestashop/classes/PVFPrestaShopOrderPayload.php',
  'connectors/prestashop/classes/PVFPrestaShopOrderSlipPayload.php',
  'connectors/prestashop/classes/PVFPrestaShopRectifications.php',
  'connectors/prestashop/classes/PVFPrestaShopTaxBreakdown.php',
  'connectors/prestashop/classes/PVFPrestaShopAdminStatus.php',
  'connectors/prestashop/examples/mapping-profile.json',
  'connectors/prestashop/examples/refund-mapping-profile.json',
  'connectors/prestashop/fixtures/tax-breakdown-v1.json',
  'connectors/prestashop/upgrade/install-0.1.0.php',
  'connectors/prestashop/upgrade/install-0.2.0.php',
  'connectors/prestashop/upgrade/install-0.3.0.php',
  'packages/core/src/mapping-assistant.mjs',
  'scripts/auth/hash-credential.mjs',
  'scripts/ops/sqlite-maintenance.mjs',
  'scripts/ci/onboarding-smoke.mjs',
  'scripts/ci/woocommerce-connector-check.mjs',
  'scripts/ci/woocommerce-package-check.mjs',
  'scripts/ci/woocommerce-compatibility-smoke.sh',
  'scripts/ci/prestashop-connector-check.mjs',
  'scripts/ci/prestashop-tax-fixtures.php',
  'scripts/ci/prestashop-rectification-fixtures.php',
  'scripts/ci/prestashop-rectification-runtime.php',
  'scripts/ci/prestashop-package-check.mjs',
  'scripts/ci/prestashop-compatibility-smoke.sh',
  'scripts/ci/prestashop-upgrade-smoke.sh',
  'scripts/release/package-woocommerce.mjs',
  'scripts/release/package-prestashop.mjs'
];

const failures = [];

for (const path of requiredPaths) {
  if (!existsSync(path)) failures.push({ code: 'REPO_REQUIRED_PATH_MISSING', path });
}

try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg?.engines?.node !== '>=22.13.0') {
    failures.push({ code: 'REPO_NODE_CONTRACT_INVALID', expected: '>=22.13.0', received: pkg?.engines?.node ?? null });
  }
  if (pkg?.scripts?.['onboarding:smoke'] !== 'node scripts/ci/onboarding-smoke.mjs') {
    failures.push({ code: 'REPO_ONBOARDING_GATE_MISSING', expected: 'onboarding:smoke script' });
  }
  if (pkg?.scripts?.['contract:reference'] !== 'node packages/connector-contract-suite/src/cli.mjs --module ./connectors/reference/contract.mjs') {
    failures.push({ code: 'REPO_CONNECTOR_CONTRACT_GATE_MISSING', expected: 'contract:reference script' });
  }
  if (pkg?.scripts?.['runtime:smoke'] !== 'node --test apps/server/test/*.test.mjs packages/sqlite-store/test/*.test.mjs') {
    failures.push({ code: 'REPO_RUNTIME_GATE_MISSING', expected: 'runtime:smoke script' });
  }
  if (pkg?.scripts?.['sqlite:backup:smoke'] !== 'node --test packages/sqlite-store/test/backup-restore.test.mjs') {
    failures.push({ code: 'REPO_SQLITE_BACKUP_GATE_MISSING', expected: 'sqlite:backup:smoke script' });
  }
  if (pkg?.scripts?.['sqlite:backup'] !== 'node scripts/ops/sqlite-maintenance.mjs backup'
      || pkg?.scripts?.['sqlite:verify-backup'] !== 'node scripts/ops/sqlite-maintenance.mjs verify'
      || pkg?.scripts?.['sqlite:restore'] !== 'node scripts/ops/sqlite-maintenance.mjs restore') {
    failures.push({ code: 'REPO_SQLITE_MAINTENANCE_COMMANDS_MISSING' });
  }
  if (pkg?.scripts?.['aeat:outbox:smoke'] !== 'node --test packages/aeat-adapter/test/aeat-adapter.test.mjs packages/sqlite-store/test/aeat-outbox.test.mjs') {
    failures.push({ code: 'REPO_AEAT_OUTBOX_GATE_MISSING', expected: 'aeat:outbox:smoke script' });
  }
  if (pkg?.scripts?.['woo:contract'] !== 'node scripts/ci/woocommerce-connector-check.mjs') {
    failures.push({ code: 'REPO_WOO_CONTRACT_GATE_MISSING', expected: 'woo:contract script' });
  }
  if (pkg?.scripts?.['woo:package'] !== 'node scripts/release/package-woocommerce.mjs') {
    failures.push({ code: 'REPO_WOO_PACKAGE_SCRIPT_MISSING', expected: 'woo:package script' });
  }
  if (pkg?.scripts?.['woo:package:check'] !== 'node scripts/ci/woocommerce-package-check.mjs') {
    failures.push({ code: 'REPO_WOO_PACKAGE_GATE_MISSING', expected: 'woo:package:check script' });
  }
  if (pkg?.scripts?.['prestashop:contract'] !== 'node scripts/ci/prestashop-connector-check.mjs') {
    failures.push({ code: 'REPO_PRESTASHOP_CONTRACT_GATE_MISSING', expected: 'prestashop:contract script' });
  }
  if (pkg?.scripts?.['prestashop:fixtures'] !== 'php scripts/ci/prestashop-tax-fixtures.php') {
    failures.push({ code: 'REPO_PRESTASHOP_FIXTURE_GATE_MISSING', expected: 'prestashop:fixtures script' });
  }
  if (pkg?.scripts?.['prestashop:rectification-fixtures'] !== 'php scripts/ci/prestashop-rectification-fixtures.php') {
    failures.push({ code: 'REPO_PRESTASHOP_RECTIFICATION_FIXTURE_GATE_MISSING', expected: 'prestashop:rectification-fixtures script' });
  }
  if (pkg?.scripts?.['prestashop:package'] !== 'node scripts/release/package-prestashop.mjs') {
    failures.push({ code: 'REPO_PRESTASHOP_PACKAGE_SCRIPT_MISSING', expected: 'prestashop:package script' });
  }
  if (pkg?.scripts?.['prestashop:package:check'] !== 'node scripts/ci/prestashop-package-check.mjs') {
    failures.push({ code: 'REPO_PRESTASHOP_PACKAGE_GATE_MISSING', expected: 'prestashop:package:check script' });
  }
  if (pkg?.scripts?.server !== 'node apps/server/src/main.mjs') {
    failures.push({ code: 'REPO_SERVER_ENTRYPOINT_MISSING', expected: 'server script' });
  }
} catch (error) {
  failures.push({ code: 'REPO_PACKAGE_JSON_INVALID', message: error.message });
}

const readme = existsSync('README.md') ? readFileSync('README.md', 'utf8') : '';
if (!readme.includes('Principio Camaleón')) {
  failures.push({ code: 'REPO_PRODUCT_PRINCIPLE_MISSING', expected: 'Principio Camaleón in README.md' });
}

const readiness = existsSync('docs/production-readiness.md') ? readFileSync('docs/production-readiness.md', 'utf8') : '';
for (const marker of ['Backup/restore', 'Outbox durable', 'reconciliation_required', 'Observabilidad', 'Perfil HA', 'gate AEAT #6']) {
  if (!readiness.includes(marker)) failures.push({ code: 'REPO_PRODUCTION_READINESS_DOC_INCOMPLETE', marker });
}

const ci = existsSync('.github/workflows/ci.yml') ? readFileSync('.github/workflows/ci.yml', 'utf8') : '';
for (const marker of [
  'npm run sqlite:backup:smoke',
  'npm run aeat:outbox:smoke',
  'prestashop-compatibility:',
  "prestashop: '1.7.8.11'",
  "prestashop: '8.1.7'",
  "prestashop: '8.2.7'",
  'scripts/ci/prestashop-compatibility-smoke.sh',
  'npm run prestashop:rectification-fixtures',
  'npm run prestashop:package:check',
  'prestashop-upgrade:',
  'scripts/ci/prestashop-upgrade-smoke.sh'
]) {
  if (!ci.includes(marker)) {
    failures.push({
      code: marker.includes('aeat:outbox')
        ? 'REPO_AEAT_OUTBOX_GATE_MISSING'
        : marker.includes('sqlite')
          ? 'REPO_SQLITE_BACKUP_GATE_MISSING'
          : 'REPO_PRESTASHOP_RELEASE_GATE_MISSING',
      marker,
    });
  }
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
