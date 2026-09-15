import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = 'connectors/woocommerce';
const required = [
  `${root}/puente-verifactu-woocommerce.php`,
  `${root}/includes/class-pv-woo-secret-store.php`,
  `${root}/includes/class-pv-woo-settings.php`,
  `${root}/includes/class-pv-woo-client.php`,
  `${root}/includes/class-pv-woo-order-payload.php`,
  `${root}/includes/class-pv-woo-connector.php`,
  `${root}/examples/mapping-profile.json`,
  `${root}/README.md`,
];
const failures = [];

function text(path) {
  try { return readFileSync(path, 'utf8'); } catch { failures.push({ code: 'WOO_REQUIRED_FILE_MISSING', path }); return ''; }
}

function phpFiles(dir) {
  const result = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) result.push(...phpFiles(path));
    else if (path.endsWith('.php')) result.push(path);
  }
  return result;
}

for (const path of required) text(path);

const bootstrap = text(`${root}/puente-verifactu-woocommerce.php`);
if (!bootstrap.includes("declare_compatibility( 'custom_order_tables'")) failures.push({ code: 'WOO_HPOS_DECLARATION_MISSING' });
if (!bootstrap.includes('WC tested up to: 11.1')) failures.push({ code: 'WOO_TESTED_VERSION_MISSING', expected: '11.1' });
if (!bootstrap.includes('Requires PHP: 7.4')) failures.push({ code: 'WOO_PHP_CONTRACT_MISSING', expected: '7.4' });

const forbiddenStorage = [
  /\$wpdb\b/,
  /\bget_post_meta\s*\(/,
  /\bupdate_post_meta\s*\(/,
  /\bdelete_post_meta\s*\(/,
  /\bwp_insert_post\s*\(/,
];
const forbiddenFiscal = [
  /RegistroAlta/,
  /SuministroInformacion/,
  /TipoHuella/,
  /soap:Envelope/i,
  /BEGIN PRIVATE KEY/,
];
for (const path of phpFiles(root)) {
  const source = text(path);
  for (const pattern of forbiddenStorage) if (pattern.test(source)) failures.push({ code: 'WOO_BYPASSES_WC_CRUD', path, pattern: String(pattern) });
  for (const pattern of forbiddenFiscal) if (pattern.test(source)) failures.push({ code: 'WOO_DUPLICATES_FISCAL_CORE', path, pattern: String(pattern) });
}

const client = text(`${root}/includes/class-pv-woo-client.php`);
for (const marker of ['/v1/preflight', '/v1/fiscal-records', 'Idempotency-Key', 'X-Connector-Version', "'redirection' => 0", "'https://'" ]) {
  if (!client.includes(marker)) failures.push({ code: 'WOO_CLIENT_CONTRACT_MISSING', marker });
}
if (/error_log\s*\(/.test(client)) failures.push({ code: 'WOO_CLIENT_SECRET_LOG_RISK', path: `${root}/includes/class-pv-woo-client.php` });

const connector = text(`${root}/includes/class-pv-woo-connector.php`);
for (const marker of ['as_enqueue_async_action', 'as_schedule_single_action', 'preflight_order', 'META_RECORD_ID', 'idempotency_key']) {
  if (!connector.includes(marker)) failures.push({ code: 'WOO_FLOW_CONTRACT_MISSING', marker });
}
const preflightIndex = connector.indexOf('$client->preflight');
const issueIndex = connector.indexOf('$client->issue');
if (preflightIndex < 0 || issueIndex < 0 || preflightIndex > issueIndex) failures.push({ code: 'WOO_PREFLIGHT_MUST_PRECEDE_ISSUE' });

const payload = text(`${root}/includes/class-pv-woo-order-payload.php`);
for (const marker of ['get_taxes()', 'get_items(', "'tax_lines'", "'source_invoice_id'", 'get_currency()']) {
  if (!payload.includes(marker)) failures.push({ code: 'WOO_PAYLOAD_CONTRACT_MISSING', marker });
}

try {
  const profile = JSON.parse(text(`${root}/examples/mapping-profile.json`));
  if (profile?.fields?.tax_lines !== 'taxBreakdown') failures.push({ code: 'WOO_PROFILE_TAX_LINES_INVALID' });
  if (profile?.fields?.currency !== 'currency') failures.push({ code: 'WOO_PROFILE_CURRENCY_INVALID' });
  for (const field of ['taxCode', 'regimeKey', 'operationClass']) {
    if (!profile?.taxLineDefaults?.[field]) failures.push({ code: 'WOO_PROFILE_TAX_DEFAULT_MISSING', field });
  }
} catch (error) {
  failures.push({ code: 'WOO_PROFILE_JSON_INVALID', message: error.message });
}

if (failures.length) {
  const diagnostic = {
    schema_version: 1,
    pipeline: 'GitHub Actions',
    job: 'validation',
    step: 'woocommerce-connector-contract',
    command: 'node scripts/ci/woocommerce-connector-check.mjs',
    exit_code: 1,
    primary_error: failures[0].code,
    failures,
    root_cause_status: 'confirmed',
  };
  console.error(JSON.stringify(diagnostic, null, 2));
  console.error(`::error title=${failures[0].code}::WooCommerce connector contract failed; inspect structured diagnostic above.`);
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'woocommerce-connector-v1',
  php_files: phpFiles(root).length,
}, null, 2));
