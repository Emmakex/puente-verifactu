import { readFileSync, existsSync } from 'node:fs';

const required = [
  'connectors/prestashop/README.md',
  'connectors/prestashop/puenteverifactu.php',
  'connectors/prestashop/classes/PVFPrestaShopSecretStore.php',
  'connectors/prestashop/classes/PVFPrestaShopClient.php',
  'connectors/prestashop/classes/PVFPrestaShopOrderPayload.php',
  'connectors/prestashop/examples/mapping-profile.json'
];

const failures = [];
for (const path of required) {
  if (!existsSync(path)) failures.push({ code: 'PRESTA_REQUIRED_PATH_MISSING', path });
}

const moduleFile = existsSync(required[1]) ? readFileSync(required[1], 'utf8') : '';
const clientFile = existsSync(required[3]) ? readFileSync(required[3], 'utf8') : '';
const secretFile = existsSync(required[2]) ? readFileSync(required[2], 'utf8') : '';
const payloadFile = existsSync(required[4]) ? readFileSync(required[4], 'utf8') : '';
const readme = existsSync(required[0]) ? readFileSync(required[0], 'utf8') : '';

const expectations = [
  [moduleFile.includes('class PuenteVerifactu extends Module'), 'PRESTA_MODULE_CLASS_MISSING'],
  [moduleFile.includes("'min' => '1.7.8.0'") && moduleFile.includes("'max' => '8.99.99'"), 'PRESTA_VERSION_RANGE_MISSING'],
  [moduleFile.includes("runManualAction('preflight')") && moduleFile.includes("runManualAction('send')") && moduleFile.includes("runManualAction('reconcile')"), 'PRESTA_MANUAL_SAFE_FLOW_MISSING'],
  [moduleFile.includes('idempotencyKey') && moduleFile.includes("':invoice:'"), 'PRESTA_IDEMPOTENCY_MISSING'],
  [moduleFile.includes('pvf_order_sync') && moduleFile.includes('UNIQUE KEY `pvf_shop_order`'), 'PRESTA_LOCAL_SYNC_STATE_MISSING'],
  [clientFile.includes("strpos($this->endpoint, 'https://') === 0"), 'PRESTA_HTTPS_GUARD_MISSING'],
  [clientFile.includes('CURLOPT_SSL_VERIFYPEER => true') && clientFile.includes('CURLOPT_SSL_VERIFYHOST => 2'), 'PRESTA_TLS_VERIFY_MISSING'],
  [clientFile.includes("'Idempotency-Key: '"), 'PRESTA_IDEMPOTENCY_HEADER_MISSING'],
  [clientFile.includes("'X-Connector-Version: prestashop/'"), 'PRESTA_CONNECTOR_VERSION_HEADER_MISSING'],
  [secretFile.includes("'aes-256-gcm'") && secretFile.includes('_COOKIE_KEY_'), 'PRESTA_TOKEN_ENCRYPTION_MISSING'],
  [payloadFile.includes("'source_invoice_id' => 'prestashop:'"), 'PRESTA_SOURCE_ID_MISSING'],
  [payloadFile.includes('$order->invoice_number') && !payloadFile.includes("'invoice_number' => trim((string) $order->reference)"), 'PRESTA_FISCAL_NUMBER_CONTRACT_MISSING'],
  [payloadFile.includes("'order_detail` WHERE `id_order`") && payloadFile.includes("'tax_lines'"), 'PRESTA_TAX_BREAKDOWN_MISSING'],
  [payloadFile.includes("'currency' => strtoupper"), 'PRESTA_CURRENCY_MISSING'],
  [readme.includes('No contiene reglas AEAT'), 'PRESTA_THIN_CONNECTOR_DOC_MISSING']
];

for (const [ok, code] of expectations) {
  if (!ok) failures.push({ code });
}

for (const [path, content] of [[required[1], moduleFile], [required[3], clientFile], [required[4], payloadFile]]) {
  if (/certificado|certificate|SOAP|RegistroAlta|RegistroAnulacion/i.test(content)) {
    failures.push({ code: 'PRESTA_FISCAL_LOGIC_LEAK', path });
  }
}

try {
  const profile = JSON.parse(readFileSync(required[5], 'utf8'));
  if (profile?.sourceType !== 'native' || profile?.fields?.invoice_number !== 'number' || profile?.fields?.tax_lines !== 'taxBreakdown') {
    failures.push({ code: 'PRESTA_MAPPING_PROFILE_INVALID' });
  }
  if (!profile?.taxLineDefaults || !profile?.constants?.issuer) {
    failures.push({ code: 'PRESTA_SERVER_SIDE_FISCAL_DEFAULTS_MISSING' });
  }
} catch (error) {
  failures.push({ code: 'PRESTA_MAPPING_PROFILE_INVALID_JSON', message: error.message });
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
  required_paths: required.length
}, null, 2));
