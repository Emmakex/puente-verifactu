import { readFileSync, existsSync } from 'node:fs';

const paths = {
  readme: 'connectors/prestashop/README.md',
  module: 'connectors/prestashop/puenteverifactu.php',
  secret: 'connectors/prestashop/classes/PVFPrestaShopSecretStore.php',
  client: 'connectors/prestashop/classes/PVFPrestaShopClient.php',
  payload: 'connectors/prestashop/classes/PVFPrestaShopOrderPayload.php',
  breakdown: 'connectors/prestashop/classes/PVFPrestaShopTaxBreakdown.php',
  adminStatus: 'connectors/prestashop/classes/PVFPrestaShopAdminStatus.php',
  mapping: 'connectors/prestashop/examples/mapping-profile.json',
  fixtures: 'connectors/prestashop/fixtures/tax-breakdown-v1.json',
  upgradeStatus: 'connectors/prestashop/upgrade/install-0.2.0.php',
  taxFixtureScript: 'scripts/ci/prestashop-tax-fixtures.php'
};

const required = Object.values(paths);
const failures = [];
for (const path of required) {
  if (!existsSync(path)) failures.push({ code: 'PRESTA_REQUIRED_PATH_MISSING', path });
}

function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const moduleFile = read(paths.module);
const clientFile = read(paths.client);
const secretFile = read(paths.secret);
const payloadFile = read(paths.payload);
const breakdownFile = read(paths.breakdown);
const statusFile = read(paths.adminStatus);
const upgradeStatusFile = read(paths.upgradeStatus);
const readme = read(paths.readme);

const expectations = [
  [moduleFile.includes('class PuenteVerifactu extends Module'), 'PRESTA_MODULE_CLASS_MISSING'],
  [moduleFile.includes("const VERSION = '0.2.0'"), 'PRESTA_MODULE_VERSION_INVALID'],
  [moduleFile.includes("'min' => '1.7.8.0'") && moduleFile.includes("'max' => '8.99.99'"), 'PRESTA_VERSION_RANGE_MISSING'],
  [moduleFile.includes("runManualAction('preflight')") && moduleFile.includes("runManualAction('send')") && moduleFile.includes("runManualAction('reconcile')"), 'PRESTA_MANUAL_SAFE_FLOW_MISSING'],
  [moduleFile.includes('idempotencyKey') && moduleFile.includes("':invoice:'"), 'PRESTA_IDEMPOTENCY_MISSING'],
  [moduleFile.includes('pvf_order_sync') && moduleFile.includes('UNIQUE KEY `pvf_shop_order`'), 'PRESTA_LOCAL_SYNC_STATE_MISSING'],
  [moduleFile.includes("registerHook('displayAdminOrderMainBottom')") && moduleFile.includes('hookDisplayAdminOrderMainBottom'), 'PRESTA_NATIVE_ORDER_STATUS_HOOK_MISSING'],
  [moduleFile.includes('PVFPrestaShopAdminStatus::summarize') && moduleFile.includes('getSyncRow($orderId)'), 'PRESTA_NATIVE_ORDER_STATUS_LOCAL_READ_MISSING'],
  [moduleFile.includes("'green' => $this->l('Synced')") && moduleFile.includes("'amber' => $this->l('Pending / review')") && moduleFile.includes("'red' => $this->l('Action required')") && moduleFile.includes("'gray' => $this->l('Not sent')"), 'PRESTA_NATIVE_ORDER_STATUS_LABELS_MISSING'],
  [clientFile.includes("strpos($this->endpoint, 'https://') === 0"), 'PRESTA_HTTPS_GUARD_MISSING'],
  [clientFile.includes('CURLOPT_SSL_VERIFYPEER => true') && clientFile.includes('CURLOPT_SSL_VERIFYHOST => 2'), 'PRESTA_TLS_VERIFY_MISSING'],
  [clientFile.includes("'Idempotency-Key: '"), 'PRESTA_IDEMPOTENCY_HEADER_MISSING'],
  [clientFile.includes("'X-Connector-Version: prestashop/'"), 'PRESTA_CONNECTOR_VERSION_HEADER_MISSING'],
  [secretFile.includes("'aes-256-gcm'") && secretFile.includes('_COOKIE_KEY_'), 'PRESTA_TOKEN_ENCRYPTION_MISSING'],
  [payloadFile.includes("'source_invoice_id' => 'prestashop:'"), 'PRESTA_SOURCE_ID_MISSING'],
  [payloadFile.includes('getInvoicesCollection()') && payloadFile.includes('count($invoices) > 1'), 'PRESTA_INVOICE_SCOPE_GUARD_MISSING'],
  [payloadFile.includes('->getInvoiceNumberFormatted(') && !payloadFile.includes('OrderInvoice::getInvoiceNumberFormatted('), 'PRESTA_INVOICE_NUMBER_API_INVALID'],
  [payloadFile.includes('getProductTaxesBreakdown($order)') && payloadFile.includes('getShippingTaxesBreakdown($order)') && payloadFile.includes('getWrappingTaxesBreakdown()'), 'PRESTA_NATIVE_INVOICE_BREAKDOWN_MISSING'],
  [!payloadFile.includes("FROM `' . _DB_PREFIX_ . 'order_detail`"), 'PRESTA_RAW_ORDER_DETAIL_TAX_QUERY_FORBIDDEN'],
  [payloadFile.includes('Ecotax requires an explicit fiscal mapping'), 'PRESTA_ECOTAX_SAFE_BLOCK_MISSING'],
  [payloadFile.includes("'currency' => strtoupper"), 'PRESTA_CURRENCY_MISSING'],
  [breakdownFile.includes('final class PVFPrestaShopTaxBreakdown') && breakdownFile.includes('public static function reconcile'), 'PRESTA_BREAKDOWN_RECONCILIATION_MISSING'],
  [breakdownFile.includes("mergeScaledLine($lines, '0'"), 'PRESTA_ZERO_RATE_RESIDUAL_MISSING'],
  [statusFile.includes('final class PVFPrestaShopAdminStatus') && statusFile.includes('public static function summarize'), 'PRESTA_ADMIN_STATUS_CLASS_INVALID'],
  [statusFile.includes("$status === 'accepted'") && statusFile.includes("array('blocked', 'rejected', 'aeat_rejected', 'failed')"), 'PRESTA_ADMIN_STATUS_MAPPING_MISSING'],
  [statusFile.includes("return 'gray'") && statusFile.includes("return 'green'") && statusFile.includes("return 'red'") && statusFile.includes("return 'amber'"), 'PRESTA_ADMIN_STATUS_LEVELS_MISSING'],
  [upgradeStatusFile.includes('upgrade_module_0_2_0') && upgradeStatusFile.includes("registerHook('displayAdminOrderMainBottom')"), 'PRESTA_STATUS_UPGRADE_HOOK_MISSING'],
  [readme.includes('No contiene reglas AEAT'), 'PRESTA_THIN_CONNECTOR_DOC_MISSING']
];

for (const [ok, code] of expectations) {
  if (!ok) failures.push({ code });
}

for (const [path, content] of [
  [paths.module, moduleFile],
  [paths.client, clientFile],
  [paths.payload, payloadFile],
  [paths.adminStatus, statusFile],
  [paths.upgradeStatus, upgradeStatusFile]
]) {
  if (/certificado|certificate|SOAP|RegistroAlta|RegistroAnulacion/i.test(content)) {
    failures.push({ code: 'PRESTA_FISCAL_LOGIC_LEAK', path });
  }
}

try {
  const profile = JSON.parse(readFileSync(paths.mapping, 'utf8'));
  if (profile?.sourceType !== 'native' || profile?.fields?.invoice_number !== 'number' || profile?.fields?.tax_lines !== 'taxBreakdown') {
    failures.push({ code: 'PRESTA_MAPPING_PROFILE_INVALID' });
  }
  if (!profile?.taxLineDefaults || !profile?.constants?.issuer) {
    failures.push({ code: 'PRESTA_SERVER_SIDE_FISCAL_DEFAULTS_MISSING' });
  }
} catch (error) {
  failures.push({ code: 'PRESTA_MAPPING_PROFILE_INVALID_JSON', message: error.message });
}

try {
  const fixture = JSON.parse(readFileSync(paths.fixtures, 'utf8'));
  const ids = new Set((fixture?.cases ?? []).map((item) => item?.id));
  for (const id of [
    'multi-rate-shipping-wrapping',
    'global-discount-already-allocated-by-prestashop',
    'free-shipping-does-not-create-tax-line',
    'mixed-tax-with-zero-rate-residual'
  ]) {
    if (!ids.has(id)) failures.push({ code: 'PRESTA_REQUIRED_FIXTURE_CASE_MISSING', id });
  }
} catch (error) {
  failures.push({ code: 'PRESTA_FIXTURE_INVALID_JSON', message: error.message });
}

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    pipeline: 'GitHub Actions',
    job: 'validation',
    step: 'prestashop-connector-contract',
    exit_code: 1,
    primary_error: failures[0].code,
    failures,
    root_cause_status: 'confirmed'
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'prestashop-connector-v1',
  required_paths: required.length,
  native_order_status: true
}, null, 2));
