#!/usr/bin/env bash
set -Eeuo pipefail

: "${PRESTASHOP_IMAGE:?PRESTASHOP_IMAGE is required}"
: "${PRESTASHOP_VERSION:?PRESTASHOP_VERSION is required}"
: "${PRESTASHOP_PHP:?PRESTASHOP_PHP is required}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
SUFFIX="$(printf '%s-%s-%s' "$PRESTASHOP_VERSION" "${GITHUB_RUN_ID:-local}" "$RANDOM" | tr -cd '[:alnum:]-' | tr '[:upper:]' '[:lower:]')"
NETWORK="pvf-presta-up-${SUFFIX}"
DB_CONTAINER="pvf-db-up-${SUFFIX}"
PS_CONTAINER="pvf-ps-up-${SUFFIX}"
BASELINE_MODULES="$TMP/baseline-modules"
BASELINE_TREE="$TMP/baseline-tree"
TARGET_TREE="$TMP/target-tree"
TARGET_ZIP="$TMP/puenteverifactu-target.zip"
PORT="8081"

cleanup() {
  set +e
  docker rm -f "$PS_CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
  local code="$1"
  local message="$2"
  echo "::error title=${code}::${message}" >&2
  echo "[presta-upgrade] ${code}: ${message}" >&2
  docker logs "$PS_CONTAINER" 2>&1 | tail -n 160 >&2 || true
  exit 1
}

mkdir -p "$BASELINE_MODULES" "$BASELINE_TREE" "$TARGET_TREE"
node "$ROOT/scripts/release/package-prestashop.mjs" --output "$TARGET_ZIP" >/dev/null
unzip -q "$TARGET_ZIP" -d "$TARGET_TREE"
cp -R "$TARGET_TREE/puenteverifactu" "$BASELINE_TREE/puenteverifactu"
sed -i "s/const VERSION = '0.4.0';/const VERSION = '0.3.0';/" "$BASELINE_TREE/puenteverifactu/puenteverifactu.php"
sed -i "/PVFPrestaShopAutomation::installDefaults(\$shopId)/d" "$BASELINE_TREE/puenteverifactu/puenteverifactu.php"
sed -i "/registerHook('actionOrderStatusPostUpdate')/d" "$BASELINE_TREE/puenteverifactu/puenteverifactu.php"
sed -i "/registerHook('actionOrderSlipAdd')/d" "$BASELINE_TREE/puenteverifactu/puenteverifactu.php"
sed -i "/registerHook('displayAdminOrderMainBottom')/ s/$/;/" "$BASELINE_TREE/puenteverifactu/puenteverifactu.php"
rm -f "$BASELINE_TREE/puenteverifactu/upgrade/install-0.4.0.php"

if ! php -l "$BASELINE_TREE/puenteverifactu/puenteverifactu.php" >/dev/null; then
  fail "PRESTA_UPGRADE_BASELINE_SYNTAX_INVALID" "Synthetic 0.3.0 baseline is not valid PHP after removing 0.4.0 wiring."
fi

(
  cd "$BASELINE_TREE"
  zip -qr "$BASELINE_MODULES/puenteverifactu.zip" puenteverifactu
)
chmod -R a+rX "$BASELINE_MODULES"

cat >"$TMP/before.php" <<'PHP'
<?php
require '/var/www/html/config/config.inc.php';

function failUpgrade($code, $message)
{
    fwrite(STDERR, json_encode(array('status' => 'failed', 'code' => $code, 'message' => $message)) . PHP_EOL);
    exit(1);
}

$module = Module::getInstanceByName('puenteverifactu');
if (!$module || empty($module->active)) {
    failUpgrade('PRESTA_UPGRADE_BASELINE_NOT_ACTIVE', 'Synthetic 0.3.0 baseline is not active.');
}
if ((string) $module->version !== '0.3.0') {
    failUpgrade('PRESTA_UPGRADE_BASELINE_VERSION', 'Expected baseline 0.3.0, received ' . (string) $module->version);
}
if (!$module->isRegisteredInHook('displayAdminOrderMainBottom')) {
    failUpgrade('PRESTA_UPGRADE_BASELINE_STATUS_HOOK_MISSING', '0.3.0 baseline must contain the native order status hook.');
}
if ($module->isRegisteredInHook('actionOrderStatusPostUpdate') || $module->isRegisteredInHook('actionOrderSlipAdd')) {
    failUpgrade('PRESTA_UPGRADE_BASELINE_AUTO_HOOK_PRESENT', '0.3.0 baseline must not contain automatic event hooks.');
}

Configuration::deleteByName('PVF_AUTO_INVOICES');
Configuration::deleteByName('PVF_AUTO_RECTIFICATIONS');

Db::getInstance()->delete('pvf_order_sync', '`id_shop` = 1 AND `id_order` = 424242');
$ok = Db::getInstance()->insert('pvf_order_sync', array(
    'id_shop' => 1,
    'id_order' => 424242,
    'record_id' => 'upgrade-sentinel-record',
    'idempotency_key' => 'upgrade-sentinel-key',
    'status' => 'accepted',
    'last_error' => '',
    'date_upd' => date('Y-m-d H:i:s'),
));
if (!$ok) {
    failUpgrade('PRESTA_UPGRADE_SENTINEL_INSERT_FAILED', 'Could not insert original-invoice synchronization sentinel.');
}

Db::getInstance()->delete('pvf_order_slip_sync', '`id_shop` = 1 AND `id_order_slip` = 434343');
if (!Db::getInstance()->insert('pvf_order_slip_sync', array(
    'id_shop' => 1,
    'id_order' => 424242,
    'id_order_slip' => 434343,
    'record_id' => 'upgrade-corrective-record',
    'idempotency_key' => 'upgrade-corrective-key',
    'status' => 'accepted',
    'last_error' => '',
    'date_upd' => date('Y-m-d H:i:s'),
))) {
    failUpgrade('PRESTA_UPGRADE_RECTIFICATION_SENTINEL_INSERT_FAILED', 'Could not insert corrective synchronization sentinel.');
}

echo json_encode(array(
    'status' => 'ok',
    'baseline' => (string) $module->version,
    'status_hook_registered' => true,
    'automation_hooks_registered' => false,
    'invoice_state_seeded' => true,
    'corrective_state_seeded' => true,
)) . PHP_EOL;
PHP

cat >"$TMP/after.php" <<'PHP'
<?php
require '/var/www/html/config/config.inc.php';

function failUpgrade($code, $message)
{
    fwrite(STDERR, json_encode(array('status' => 'failed', 'code' => $code, 'message' => $message)) . PHP_EOL);
    exit(1);
}

$expectedPs = (string) getenv('EXPECTED_PS_VERSION');
$expectedPhp = (string) getenv('EXPECTED_PHP_VERSION');
$actualPhp = PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;
if ((string) _PS_VERSION_ !== $expectedPs || $actualPhp !== $expectedPhp) {
    failUpgrade('PRESTA_UPGRADE_RUNTIME_CHANGED', 'Unexpected PrestaShop/PHP runtime after upgrade.');
}

$module = Module::getInstanceByName('puenteverifactu');
if (!$module || empty($module->active)) {
    failUpgrade('PRESTA_UPGRADE_TARGET_NOT_ACTIVE', 'Target module is not active after upgrade.');
}
if ((string) $module->version !== '0.4.0') {
    failUpgrade('PRESTA_UPGRADE_TARGET_VERSION', 'Expected target 0.4.0, received ' . (string) $module->version);
}
if (!$module->isRegisteredInHook('displayAdminOrderMainBottom')) {
    failUpgrade('PRESTA_UPGRADE_STATUS_HOOK_MISSING', 'Upgrade lost displayAdminOrderMainBottom registration.');
}
if (!$module->isRegisteredInHook('actionOrderStatusPostUpdate') || !$module->isRegisteredInHook('actionOrderSlipAdd')) {
    failUpgrade('PRESTA_UPGRADE_AUTOMATION_HOOK_MISSING', '0.4.0 upgrade did not register both automation hooks.');
}

$row = Db::getInstance()->getRow(
    'SELECT * FROM `' . _DB_PREFIX_ . 'pvf_order_sync` WHERE `id_shop` = 1 AND `id_order` = 424242'
);
if (!is_array($row)
    || (string) $row['record_id'] !== 'upgrade-sentinel-record'
    || (string) $row['idempotency_key'] !== 'upgrade-sentinel-key'
    || (string) $row['status'] !== 'accepted') {
    failUpgrade('PRESTA_UPGRADE_STATE_LOST', 'Original-invoice synchronization state was not preserved through upgrade.');
}

$corrective = Db::getInstance()->getRow(
    'SELECT * FROM `' . _DB_PREFIX_ . 'pvf_order_slip_sync` WHERE `id_shop` = 1 AND `id_order_slip` = 434343'
);
if (!is_array($corrective)
    || (string) $corrective['record_id'] !== 'upgrade-corrective-record'
    || (string) $corrective['idempotency_key'] !== 'upgrade-corrective-key'
    || (string) $corrective['status'] !== 'accepted') {
    failUpgrade('PRESTA_UPGRADE_RECTIFICATION_STATE_LOST', 'Corrective synchronization state was not preserved through upgrade.');
}

if ((int) Configuration::get('PVF_AUTO_INVOICES', null, null, 1) !== 0
    || (int) Configuration::get('PVF_AUTO_RECTIFICATIONS', null, null, 1) !== 0) {
    failUpgrade('PRESTA_UPGRADE_AUTOMATION_NOT_OFF', '0.4.0 must leave both automatic modes disabled after upgrade.');
}

$moduleDbVersion = (string) Db::getInstance()->getValue(
    "SELECT version FROM `" . _DB_PREFIX_ . "module` WHERE name = 'puenteverifactu'"
);
if ($moduleDbVersion !== '0.4.0') {
    failUpgrade('PRESTA_UPGRADE_DB_VERSION', 'Module database version was not advanced to 0.4.0.');
}

fwrite(STDOUT, json_encode(array(
    'schema_version' => 1,
    'status' => 'ok',
    'check' => 'prestashop-upgrade-smoke',
    'prestashop' => (string) _PS_VERSION_,
    'php' => $actualPhp,
    'from' => '0.3.0',
    'to' => (string) $module->version,
    'invoice_state_preserved' => true,
    'corrective_state_preserved' => true,
    'status_hook_registered' => true,
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
[[ "$DB_READY" == "1" ]] || fail "PRESTA_UPGRADE_DB_TIMEOUT" "MariaDB did not become ready."

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
  -v "$BASELINE_MODULES:/ps-modules:ro" \
  "$PRESTASHOP_IMAGE" >/dev/null

PS_READY=0
for _ in $(seq 1 90); do
  RUNNING="$(docker inspect -f '{{.State.Running}}' "$PS_CONTAINER" 2>/dev/null || true)"
  if [[ "$RUNNING" != "true" ]]; then
    EXIT_CODE="$(docker inspect -f '{{.State.ExitCode}}' "$PS_CONTAINER" 2>/dev/null || true)"
    fail "PRESTA_UPGRADE_CONTAINER_EXITED" "PrestaShop exited before readiness (exit=${EXIT_CODE:-unknown})."
  fi
  if curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
    PS_READY=1
    break
  fi
  sleep 2
done
[[ "$PS_READY" == "1" ]] || fail "PRESTA_UPGRADE_HTTP_TIMEOUT" "PrestaShop did not become HTTP-ready."

docker cp "$TMP/before.php" "$PS_CONTAINER:/tmp/pvf-before.php"
docker exec "$PS_CONTAINER" php /tmp/pvf-before.php

docker cp "$TARGET_TREE/puenteverifactu/." "$PS_CONTAINER:/var/www/html/modules/puenteverifactu/"
docker exec "$PS_CONTAINER" php bin/console prestashop:module --no-interaction upgrade puenteverifactu

docker cp "$TMP/after.php" "$PS_CONTAINER:/tmp/pvf-after.php"
docker exec \
  -e EXPECTED_PS_VERSION="$PRESTASHOP_VERSION" \
  -e EXPECTED_PHP_VERSION="$PRESTASHOP_PHP" \
  "$PS_CONTAINER" php /tmp/pvf-after.php

echo "[presta-upgrade] upgrade smoke passed for PrestaShop ${PRESTASHOP_VERSION} / PHP ${PRESTASHOP_PHP}"
