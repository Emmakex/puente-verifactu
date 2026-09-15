#!/usr/bin/env bash
set -Eeuo pipefail

: "${PRESTASHOP_IMAGE:?PRESTASHOP_IMAGE is required}"
: "${PRESTASHOP_VERSION:?PRESTASHOP_VERSION is required}"
: "${PRESTASHOP_PHP:?PRESTASHOP_PHP is required}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
SUFFIX="$(printf '%s-%s-%s' "$PRESTASHOP_VERSION" "${GITHUB_RUN_ID:-local}" "$RANDOM" | tr -cd '[:alnum:]-' | tr '[:upper:]' '[:lower:]')"
NETWORK="pvf-presta-${SUFFIX}"
DB_CONTAINER="pvf-db-${SUFFIX}"
PS_CONTAINER="pvf-ps-${SUFFIX}"
MODULES_DIR="$TMP/modules"
PORT="8080"

cleanup() {
  set +e
  docker logs "$PS_CONTAINER" >"$TMP/prestashop.log" 2>&1 || true
  docker rm -f "$PS_CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  if [[ "${PVF_KEEP_PRESTASHOP_CI_TMP:-0}" != "1" ]]; then
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

fail() {
  local code="$1"
  local message="$2"
  echo "::error title=${code}::${message}" >&2
  echo "[presta-ci] ${code}: ${message}" >&2
  docker logs "$PS_CONTAINER" 2>&1 | tail -n 160 >&2 || true
  exit 1
}

mkdir -p "$MODULES_DIR"
node "$ROOT/scripts/release/package-prestashop.mjs" --output "$MODULES_DIR/puenteverifactu.zip" >/dev/null
chmod -R a+rX "$MODULES_DIR"

cat >"$TMP/verify.php" <<'PHP'
<?php
require '/var/www/html/config/config.inc.php';

function pvfFail($code, $message)
{
    fwrite(STDERR, json_encode(array(
        'schema_version' => 1,
        'status' => 'failed',
        'code' => $code,
        'message' => $message,
    ), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit(1);
}

function pvfHydrateContext(Order $order)
{
    $context = Context::getContext();
    $context->shop = new Shop((int) $order->id_shop);
    $context->currency = new Currency((int) $order->id_currency);
    $context->language = new Language((int) $order->id_lang);
    $context->customer = new Customer((int) $order->id_customer);
    $context->cart = new Cart((int) $order->id_cart);

    $invoiceAddress = new Address((int) $order->id_address_invoice);
    if (Validate::isLoadedObject($invoiceAddress)) {
        $context->country = new Country((int) $invoiceAddress->id_country, (int) $order->id_lang);
    }

    if (!Validate::isLoadedObject($context->shop)
        || !Validate::isLoadedObject($context->currency)
        || !Validate::isLoadedObject($context->language)) {
        pvfFail('PRESTA_CONTEXT_INIT_FAILED', 'Could not hydrate PrestaShop CLI context from the seed order.');
    }
}

$expectedPs = (string) getenv('EXPECTED_PS_VERSION');
$expectedPhp = (string) getenv('EXPECTED_PHP_VERSION');
$actualPhp = PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;

if ((string) _PS_VERSION_ !== $expectedPs) {
    pvfFail('PRESTA_VERSION_MISMATCH', 'Expected PrestaShop ' . $expectedPs . ', received ' . _PS_VERSION_);
}
if ($actualPhp !== $expectedPhp) {
    pvfFail('PRESTA_PHP_VERSION_MISMATCH', 'Expected PHP ' . $expectedPhp . ', received ' . $actualPhp);
}
if (!Module::isInstalled('puenteverifactu')) {
    pvfFail('PRESTA_MODULE_NOT_INSTALLED', 'puenteverifactu is not installed.');
}

$module = Module::getInstanceByName('puenteverifactu');
if (!$module || empty($module->active)) {
    pvfFail('PRESTA_MODULE_NOT_ACTIVE', 'puenteverifactu is not active.');
}
if ((string) $module->version !== '0.4.0') {
    pvfFail('PRESTA_MODULE_VERSION_MISMATCH', 'Expected module 0.4.0, received ' . (string) $module->version);
}
if (!$module->isRegisteredInHook('displayAdminOrderMainBottom')) {
    pvfFail('PRESTA_ORDER_STATUS_HOOK_MISSING', 'displayAdminOrderMainBottom was not registered.');
}
if (!$module->isRegisteredInHook('actionOrderStatusPostUpdate') || !$module->isRegisteredInHook('actionOrderSlipAdd')) {
    pvfFail('PRESTA_AUTOMATION_HOOK_MISSING', 'Opt-in automation hooks were not registered.');
}
if (!class_exists('PVFPrestaShopOrderPayload')
    || !class_exists('PVFPrestaShopOrderSlipPayload')
    || !class_exists('PVFPrestaShopRectifications')
    || !class_exists('PVFPrestaShopAutomation')
    || !class_exists('PVFPrestaShopTaxBreakdown')
    || !class_exists('PVFPrestaShopAdminStatus')) {
    pvfFail('PRESTA_RUNTIME_CLASSES_MISSING', 'Connector runtime classes were not loaded.');
}

$summaryCases = array(
    array(null, 'gray'),
    array(array('status' => 'accepted', 'record_id' => 'r1', 'last_error' => '', 'date_upd' => ''), 'green'),
    array(array('status' => 'preflight_valid', 'record_id' => '', 'last_error' => '', 'date_upd' => ''), 'amber'),
    array(array('status' => 'blocked', 'record_id' => '', 'last_error' => 'blocked', 'date_upd' => ''), 'red'),
    array(array('status' => 'accepted', 'record_id' => 'r1', 'last_error' => 'review', 'date_upd' => ''), 'amber'),
);
foreach ($summaryCases as $case) {
    $summary = PVFPrestaShopAdminStatus::summarize($case[0]);
    if ((string) $summary['level'] !== $case[1]) {
        pvfFail('PRESTA_ORDER_STATUS_LEVEL_INVALID', 'Unexpected traffic-light level for status summary fixture.');
    }
}

$table = _DB_PREFIX_ . 'pvf_order_sync';
$tableExists = (int) Db::getInstance()->getValue(
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '" . pSQL($table) . "'"
);
if ($tableExists !== 1) {
    pvfFail('PRESTA_SYNC_TABLE_MISSING', 'Connector sync table was not created.');
}

$rectTable = _DB_PREFIX_ . 'pvf_order_slip_sync';
$rectTableExists = (int) Db::getInstance()->getValue(
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '" . pSQL($rectTable) . "'"
);
if ($rectTableExists !== 1) {
    pvfFail('PRESTA_RECT_SYNC_TABLE_MISSING', 'Corrective sync table was not created.');
}

$orderId = (int) Db::getInstance()->getValue(
    'SELECT oi.`id_order` FROM `' . _DB_PREFIX_ . 'order_invoice` oi '
    . 'WHERE oi.`number` > 0 GROUP BY oi.`id_order` HAVING COUNT(*) = 1 ORDER BY oi.`id_order` ASC'
);

if ($orderId <= 0) {
    $orderId = (int) Db::getInstance()->getValue(
        'SELECT o.`id_order` FROM `' . _DB_PREFIX_ . 'orders` o '
        . 'INNER JOIN `' . _DB_PREFIX_ . 'order_detail` od ON od.`id_order` = o.`id_order` '
        . 'GROUP BY o.`id_order` ORDER BY o.`id_order` ASC'
    );
    if ($orderId <= 0) {
        pvfFail('PRESTA_SEED_ORDER_MISSING', 'Flashlight seed contains no order with order details for the smoke test.');
    }

    $seedOrder = new Order($orderId);
    if (!Validate::isLoadedObject($seedOrder)) {
        pvfFail('PRESTA_SEED_ORDER_INVALID', 'Seed order could not be loaded before invoice generation.');
    }

    pvfHydrateContext($seedOrder);

    try {
        Configuration::updateValue('PS_INVOICE', 1, false, null, (int) $seedOrder->id_shop);
        Configuration::updateValue('PS_INVOICE_START_NUMBER', 900001, false, null, (int) $seedOrder->id_shop);
        $seedOrder->setInvoice(false);
    } catch (Exception $exception) {
        pvfFail('PRESTA_SEED_INVOICE_CREATE_FAILED', $exception->getMessage());
    }

    $invoiceCount = (int) Db::getInstance()->getValue(
        'SELECT COUNT(*) FROM `' . _DB_PREFIX_ . 'order_invoice` WHERE `id_order` = ' . (int) $orderId . ' AND `number` > 0'
    );
    if ($invoiceCount !== 1) {
        pvfFail('PRESTA_SEED_INVOICE_CREATE_FAILED', 'Native Order::setInvoice() did not create exactly one numbered invoice.');
    }
}

$order = new Order($orderId);
if (!Validate::isLoadedObject($order)) {
    pvfFail('PRESTA_SEED_ORDER_INVALID', 'Seed order could not be loaded.');
}
pvfHydrateContext($order);

if ((int) Configuration::get(PVFPrestaShopAutomation::CONFIG_AUTO_INVOICES, null, null, (int) $order->id_shop) !== 0
    || (int) Configuration::get(PVFPrestaShopAutomation::CONFIG_AUTO_RECTIFICATIONS, null, null, (int) $order->id_shop) !== 0) {
    pvfFail('PRESTA_AUTOMATION_DEFAULT_NOT_OFF', 'Automation must be disabled by default for invoices and corrective credit slips.');
}

Db::getInstance()->delete('pvf_order_sync', '`id_shop` = ' . (int) $order->id_shop . ' AND `id_order` = ' . (int) $order->id);
$module->hookActionOrderStatusPostUpdate(array('id_order' => (int) $order->id));
$disabledRows = (int) Db::getInstance()->getValue(
    'SELECT COUNT(*) FROM `' . _DB_PREFIX_ . 'pvf_order_sync` WHERE `id_shop` = ' . (int) $order->id_shop
    . ' AND `id_order` = ' . (int) $order->id
);
if ($disabledRows !== 0) {
    pvfFail('PRESTA_INVOICE_AUTOMATION_DEFAULT_SIDE_EFFECT', 'Disabled invoice automation created local synchronization state.');
}

try {
    $payload = PVFPrestaShopOrderPayload::build($order, array('shop_id' => (int) $order->id_shop));
} catch (Exception $exception) {
    pvfFail('PRESTA_REAL_PAYLOAD_BUILD_FAILED', $exception->getMessage());
}

if (empty($payload['invoice_id']) || empty($payload['invoice_number']) || empty($payload['order_date'])) {
    pvfFail('PRESTA_REAL_PAYLOAD_INVOICE_FIELDS_MISSING', 'Real invoice payload misses fiscal identity fields.');
}
if (!isset($payload['tax_lines']) || !is_array($payload['tax_lines']) || count($payload['tax_lines']) === 0) {
    pvfFail('PRESTA_REAL_PAYLOAD_TAX_LINES_MISSING', 'Real invoice payload has no tax lines.');
}
if (!isset($payload['total_amount']) || !isset($payload['tax_amount']) || !isset($payload['currency'])) {
    pvfFail('PRESTA_REAL_PAYLOAD_TOTALS_MISSING', 'Real invoice payload misses totals/currency.');
}

Db::getInstance()->delete('pvf_order_sync', '`id_shop` = ' . (int) $order->id_shop . ' AND `id_order` = ' . (int) $order->id);
if (!Db::getInstance()->insert('pvf_order_sync', array(
    'id_shop' => (int) $order->id_shop,
    'id_order' => (int) $order->id,
    'record_id' => 'status-smoke-record',
    'idempotency_key' => 'status-smoke-key',
    'status' => 'accepted',
    'last_error' => '',
    'date_upd' => date('Y-m-d H:i:s'),
))) {
    pvfFail('PRESTA_ORDER_STATUS_SEED_FAILED', 'Could not seed local status row.');
}

$statusHtml = $module->hookDisplayAdminOrderMainBottom(array('id_order' => (int) $order->id));
if (strpos($statusHtml, 'badge-success') === false || strpos($statusHtml, 'status-smoke-record') === false) {
    pvfFail('PRESTA_ORDER_STATUS_GREEN_RENDER_FAILED', 'Accepted state did not render a green native order card.');
}

if (!Db::getInstance()->update('pvf_order_sync', array(
    'status' => 'blocked',
    'last_error' => 'status-smoke-review',
    'date_upd' => date('Y-m-d H:i:s'),
), '`id_shop` = ' . (int) $order->id_shop . ' AND `id_order` = ' . (int) $order->id)) {
    pvfFail('PRESTA_ORDER_STATUS_UPDATE_FAILED', 'Could not update local status row.');
}
$statusHtml = $module->hookDisplayAdminOrderMainBottom(array('id_order' => (int) $order->id));
if (strpos($statusHtml, 'badge-danger') === false || strpos($statusHtml, 'status-smoke-review') === false) {
    pvfFail('PRESTA_ORDER_STATUS_RED_RENDER_FAILED', 'Blocked state did not render a red native order card.');
}

if (!Db::getInstance()->update('pvf_order_sync', array(
    'status' => 'preflight_valid',
    'last_error' => '',
    'date_upd' => date('Y-m-d H:i:s'),
), '`id_shop` = ' . (int) $order->id_shop . ' AND `id_order` = ' . (int) $order->id)) {
    pvfFail('PRESTA_ORDER_STATUS_UPDATE_FAILED', 'Could not update local status row for amber state.');
}
$statusHtml = $module->hookDisplayAdminOrderMainBottom(array('id_order' => (int) $order->id));
if (strpos($statusHtml, 'badge-warning') === false) {
    pvfFail('PRESTA_ORDER_STATUS_AMBER_RENDER_FAILED', 'Pending state did not render an amber native order card.');
}

fwrite(STDOUT, json_encode(array(
    'schema_version' => 1,
    'status' => 'ok',
    'check' => 'prestashop-real-release-install-smoke',
    'prestashop' => (string) _PS_VERSION_,
    'php' => $actualPhp,
    'module' => (string) $module->version,
    'order_id' => (int) $order->id,
    'invoice_id' => (string) $payload['invoice_id'],
    'tax_lines' => count($payload['tax_lines']),
    'native_order_status_card' => true,
    'corrective_runtime_loaded' => true,
    'automation_hooks_registered' => true,
    'automation_default_off' => true,
), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
PHP

docker network create "$NETWORK" >/dev/null

docker run -d \
  --name "$DB_CONTAINER" \
  --network "$NETWORK" \
  -e MYSQL_DATABASE=prestashop \
  -e MYSQL_USER=prestashop \
  -e MYSQL_PASSWORD=prestashop \
  -e MYSQL_ROOT_PASSWORD=prestashop \
  mariadb:lts \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci >/dev/null

DB_READY=0
for _ in $(seq 1 60); do
  if docker exec "$DB_CONTAINER" mariadb-admin ping -h 127.0.0.1 -uprestashop -pprestashop --silent >/dev/null 2>&1; then
    DB_READY=1
    break
  fi
  sleep 2
done
[[ "$DB_READY" == "1" ]] || fail "PRESTA_DB_START_TIMEOUT" "MariaDB did not become ready."

docker run -d \
  --name "$PS_CONTAINER" \
  --network "$NETWORK" \
  -p "127.0.0.1:${PORT}:80" \
  -e PS_DOMAIN="localhost:${PORT}" \
  -e MYSQL_HOST="$DB_CONTAINER" \
  -e MYSQL_PORT=3306 \
  -e MYSQL_DATABASE=prestashop \
  -e MYSQL_USER=prestashop \
  -e MYSQL_PASSWORD=prestashop \
  -e INSTALL_MODULES_DIR=/ps-modules \
  -e ON_INSTALL_MODULES_FAILURE=fail \
  -v "$MODULES_DIR:/ps-modules:ro" \
  "$PRESTASHOP_IMAGE" >/dev/null

PS_READY=0
for _ in $(seq 1 90); do
  RUNNING="$(docker inspect -f '{{.State.Running}}' "$PS_CONTAINER" 2>/dev/null || true)"
  if [[ "$RUNNING" != "true" ]]; then
    EXIT_CODE="$(docker inspect -f '{{.State.ExitCode}}' "$PS_CONTAINER" 2>/dev/null || true)"
    fail "PRESTA_CONTAINER_EXITED" "PrestaShop container exited before readiness (exit=${EXIT_CODE:-unknown})."
  fi
  if curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
    PS_READY=1
    break
  fi
  sleep 2
done
[[ "$PS_READY" == "1" ]] || fail "PRESTA_HTTP_START_TIMEOUT" "PrestaShop did not become HTTP-ready."

docker cp "$TMP/verify.php" "$PS_CONTAINER:/tmp/pvf-verify.php"
docker exec \
  -e EXPECTED_PS_VERSION="$PRESTASHOP_VERSION" \
  -e EXPECTED_PHP_VERSION="$PRESTASHOP_PHP" \
  "$PS_CONTAINER" php /tmp/pvf-verify.php

docker cp "$ROOT/scripts/ci/prestashop-rectification-runtime.php" "$PS_CONTAINER:/tmp/pvf-rectification-runtime.php"
docker exec \
  -e EXPECTED_PS_VERSION="$PRESTASHOP_VERSION" \
  -e EXPECTED_PHP_VERSION="$PRESTASHOP_PHP" \
  "$PS_CONTAINER" php /tmp/pvf-rectification-runtime.php

echo "[presta-ci] release-package, opt-in automation defaults and corrective compatibility smoke passed for PrestaShop ${PRESTASHOP_VERSION} / PHP ${PRESTASHOP_PHP}"
