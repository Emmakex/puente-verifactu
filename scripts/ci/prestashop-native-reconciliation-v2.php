<?php

require '/var/www/html/config/config.inc.php';

function pvfNativeFail($code, $message, array $details = array())
{
    fwrite(STDERR, json_encode(array(
        'schema_version' => 2,
        'status' => 'failed',
        'check' => 'prestashop-native-reconciliation-v2',
        'code' => $code,
        'message' => $message,
        'details' => $details,
    ), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit(1);
}

function pvfNativeHydrateContext(Order $order)
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
}

function pvfNativeOrderRow($shopId, $orderId)
{
    $row = Db::getInstance()->getRow(
        'SELECT * FROM `' . _DB_PREFIX_ . 'pvf_order_sync` WHERE `id_shop` = ' . (int) $shopId
        . ' AND `id_order` = ' . (int) $orderId
    );
    return is_array($row) ? $row : null;
}

function pvfNativeSlipRow($shopId, $slipId)
{
    $row = Db::getInstance()->getRow(
        'SELECT * FROM `' . _DB_PREFIX_ . 'pvf_order_slip_sync` WHERE `id_shop` = ' . (int) $shopId
        . ' AND `id_order_slip` = ' . (int) $slipId
    );
    return is_array($row) ? $row : null;
}

function pvfNativeSeedOrder($shopId, $orderId, $recordId, $idempotencyKey, $status)
{
    $sql = 'INSERT INTO `' . _DB_PREFIX_ . 'pvf_order_sync` '
        . '(`id_shop`,`id_order`,`record_id`,`idempotency_key`,`status`,`last_error`,`date_upd`) VALUES ('
        . (int) $shopId . ',' . (int) $orderId . ',\'' . pSQL((string) $recordId) . '\',\''
        . pSQL((string) $idempotencyKey) . '\',\'' . pSQL((string) $status) . '\',\'\',NOW()) '
        . 'ON DUPLICATE KEY UPDATE `record_id`=VALUES(`record_id`),`idempotency_key`=VALUES(`idempotency_key`),'
        . '`status`=VALUES(`status`),`last_error`=\'\',`date_upd`=NOW()';
    if (!Db::getInstance()->execute($sql)) {
        pvfNativeFail('PRESTA_NATIVE_ORDER_SEED_FAILED', 'Could not seed invoice synchronization state.');
    }
}

function pvfNativeSeedSlip($shopId, $orderId, $slipId, $recordId, $idempotencyKey, $status)
{
    $sql = 'INSERT INTO `' . _DB_PREFIX_ . 'pvf_order_slip_sync` '
        . '(`id_shop`,`id_order`,`id_order_slip`,`record_id`,`idempotency_key`,`status`,`last_error`,`date_upd`) VALUES ('
        . (int) $shopId . ',' . (int) $orderId . ',' . (int) $slipId . ',\'' . pSQL((string) $recordId) . '\',\''
        . pSQL((string) $idempotencyKey) . '\',\'' . pSQL((string) $status) . '\',\'\',NOW()) '
        . 'ON DUPLICATE KEY UPDATE `id_order`=VALUES(`id_order`),`record_id`=VALUES(`record_id`),'
        . '`idempotency_key`=VALUES(`idempotency_key`),`status`=VALUES(`status`),'
        . '`last_error`=\'\',`date_upd`=NOW()';
    if (!Db::getInstance()->execute($sql)) {
        pvfNativeFail('PRESTA_NATIVE_SLIP_SEED_FAILED', 'Could not seed corrective synchronization state.');
    }
}

function pvfNativeAssertPreserved(array $row = null, $recordId, $idempotencyKey, $status, $scenario)
{
    if (!is_array($row)
        || (string) $row['record_id'] !== (string) $recordId
        || (string) $row['idempotency_key'] !== (string) $idempotencyKey
        || (string) $row['status'] !== (string) $status) {
        pvfNativeFail('PRESTA_NATIVE_STATE_INVALID', 'Native reconciliation state does not satisfy contract v2.', array(
            'scenario' => $scenario,
            'expected_record_id' => $recordId,
            'expected_idempotency_key' => $idempotencyKey,
            'expected_status' => $status,
            'actual' => $row,
        ));
    }
}

$fixturePath = (string) getenv('PVF_NATIVE_CONTRACT_FIXTURE');
$fixture = $fixturePath !== '' ? json_decode((string) @file_get_contents($fixturePath), true) : null;
$required = is_array($fixture) && isset($fixture['scenarios']) && is_array($fixture['scenarios'])
    ? $fixture['scenarios']
    : array();
if (count($required) !== 6) {
    pvfNativeFail('PRESTA_NATIVE_FIXTURE_INVALID', 'Native reconciliation v2 fixture was not loaded.');
}
$passed = array();

$module = Module::getInstanceByName('puenteverifactu');
if (!$module || empty($module->active)) {
    pvfNativeFail('PRESTA_NATIVE_MODULE_INACTIVE', 'Puente VeriFactu must be active.');
}
if (!class_exists('PVFPrestaShopApiException') || !class_exists('PVFPrestaShopAutomation')) {
    pvfNativeFail('PRESTA_NATIVE_RUNTIME_MISSING', 'Typed API errors and automation runtime must be loaded.');
}

$orderId = (int) Db::getInstance()->getValue(
    'SELECT oi.`id_order` FROM `' . _DB_PREFIX_ . 'order_invoice` oi '
    . 'WHERE oi.`number` > 0 GROUP BY oi.`id_order` HAVING COUNT(*) = 1 ORDER BY oi.`id_order` ASC'
);
if ($orderId <= 0) {
    pvfNativeFail('PRESTA_NATIVE_INVOICE_ORDER_MISSING', 'No single-invoice order is available for native reconciliation gate.');
}
$order = new Order($orderId);
if (!Validate::isLoadedObject($order)) {
    pvfNativeFail('PRESTA_NATIVE_ORDER_INVALID', 'Native reconciliation order could not be loaded.');
}
pvfNativeHydrateContext($order);
$shopId = (int) $order->id_shop;

Configuration::updateValue('PVF_ENDPOINT', 'https://127.0.0.1:1', false, null, $shopId);
Configuration::updateValue('PVF_PROFILE_ID', 'native-contract-invoice', false, null, $shopId);
Configuration::updateValue(PVFPrestaShopRectifications::CONFIG_PROFILE_ID, 'native-contract-corrective', false, null, $shopId);
Configuration::updateValue('PVF_TIMEOUT', 5, false, null, $shopId);
Configuration::updateValue(PVFPrestaShopAutomation::CONFIG_AUTO_INVOICES, 1, false, null, $shopId);
Configuration::updateValue(PVFPrestaShopAutomation::CONFIG_AUTO_RECTIFICATIONS, 1, false, null, $shopId);
PVFPrestaShopSecretStore::set('native-contract-token', $shopId);

// New invoice: transport failure is retryable and retries must keep exactly the same key.
Db::getInstance()->delete('pvf_order_sync', '`id_shop` = ' . $shopId . ' AND `id_order` = ' . (int) $order->id);
PVFPrestaShopAutomation::handleOrderStatus($module, array('id_order' => (int) $order->id));
$newInvoiceOne = pvfNativeOrderRow($shopId, (int) $order->id);
if (!is_array($newInvoiceOne)
    || (string) $newInvoiceOne['status'] !== 'retry_pending'
    || (string) $newInvoiceOne['record_id'] !== ''
    || (string) $newInvoiceOne['idempotency_key'] === '') {
    pvfNativeFail('PRESTA_NATIVE_NEW_INVOICE_RETRY_INVALID', 'Retryable new invoice did not persist retry_pending + idempotency.', array('row' => $newInvoiceOne));
}
$invoiceRetryKey = (string) $newInvoiceOne['idempotency_key'];
PVFPrestaShopAutomation::handleOrderStatus($module, array('id_order' => (int) $order->id));
$newInvoiceTwo = pvfNativeOrderRow($shopId, (int) $order->id);
if (!is_array($newInvoiceTwo) || (string) $newInvoiceTwo['idempotency_key'] !== $invoiceRetryKey) {
    pvfNativeFail('PRESTA_NATIVE_NEW_INVOICE_IDEMPOTENCY_CHANGED', 'Retrying the same invoice changed its idempotency key.');
}
$passed[] = 'invoice.new-retryable-idempotency-stable';

// Existing invoice + retryable status failure: preserve identity and never replace it with an issue key.
pvfNativeSeedOrder($shopId, (int) $order->id, 'fr_abc123', 'invoice-existing-key', 'accepted');
PVFPrestaShopAutomation::handleOrderStatus($module, array('id_order' => (int) $order->id));
pvfNativeAssertPreserved(
    pvfNativeOrderRow($shopId, (int) $order->id),
    'fr_abc123',
    'invoice-existing-key',
    'retry_pending',
    'invoice.existing-retryable-no-reissue'
);
$passed[] = 'invoice.existing-retryable-no-reissue';

// Existing invoice + nonretryable invalid record id: preserve identity and block; no issue fallback may occur.
pvfNativeSeedOrder($shopId, (int) $order->id, 'invalid-existing-record', 'invoice-nonretryable-key', 'accepted');
PVFPrestaShopAutomation::handleOrderStatus($module, array('id_order' => (int) $order->id));
pvfNativeAssertPreserved(
    pvfNativeOrderRow($shopId, (int) $order->id),
    'invalid-existing-record',
    'invoice-nonretryable-key',
    'blocked',
    'invoice.existing-nonretryable-no-reissue'
);
$passed[] = 'invoice.existing-nonretryable-no-reissue';

$slipId = (int) Db::getInstance()->getValue(
    'SELECT `id_order_slip` FROM `' . _DB_PREFIX_ . 'order_slip` WHERE `id_order` = ' . (int) $order->id
    . ' ORDER BY `id_order_slip` DESC'
);
if ($slipId <= 0) {
    pvfNativeFail('PRESTA_NATIVE_SLIP_MISSING', 'Corrective runtime did not provide an OrderSlip for native contract v2.');
}
$slip = new OrderSlip($slipId);
if (!Validate::isLoadedObject($slip)) {
    pvfNativeFail('PRESTA_NATIVE_SLIP_INVALID', 'Native reconciliation credit slip could not be loaded.');
}

// Ensure corrective processing sees an original fiscal record.
pvfNativeSeedOrder($shopId, (int) $order->id, 'fr_abcd01', 'original-invoice-key', 'accepted');

// New corrective: retryable preflight transport failure must keep one stable key across retries.
Db::getInstance()->delete('pvf_order_slip_sync', '`id_shop` = ' . $shopId . ' AND `id_order_slip` = ' . $slipId);
PVFPrestaShopAutomation::handleOrderSlip($module, array('order' => $order, 'orderSlipCreated' => $slip));
$newSlipOne = pvfNativeSlipRow($shopId, $slipId);
if (!is_array($newSlipOne)
    || (string) $newSlipOne['status'] !== 'retry_pending'
    || (string) $newSlipOne['record_id'] !== ''
    || (string) $newSlipOne['idempotency_key'] === '') {
    pvfNativeFail('PRESTA_NATIVE_NEW_SLIP_RETRY_INVALID', 'Retryable new corrective did not persist retry_pending + idempotency.', array('row' => $newSlipOne));
}
$slipRetryKey = (string) $newSlipOne['idempotency_key'];
PVFPrestaShopAutomation::handleOrderSlip($module, array('order' => $order, 'orderSlipCreated' => $slip));
$newSlipTwo = pvfNativeSlipRow($shopId, $slipId);
if (!is_array($newSlipTwo) || (string) $newSlipTwo['idempotency_key'] !== $slipRetryKey) {
    pvfNativeFail('PRESTA_NATIVE_NEW_SLIP_IDEMPOTENCY_CHANGED', 'Retrying the same corrective changed its idempotency key.');
}
$passed[] = 'corrective.new-retryable-idempotency-stable';

// Existing corrective + retryable status failure.
pvfNativeSeedSlip($shopId, (int) $order->id, $slipId, 'fr_abc456', 'corrective-existing-key', 'accepted');
PVFPrestaShopAutomation::handleOrderSlip($module, array('order' => $order, 'orderSlipCreated' => $slip));
pvfNativeAssertPreserved(
    pvfNativeSlipRow($shopId, $slipId),
    'fr_abc456',
    'corrective-existing-key',
    'retry_pending',
    'corrective.existing-retryable-no-reissue'
);
$passed[] = 'corrective.existing-retryable-no-reissue';

// Existing corrective + nonretryable invalid record id.
pvfNativeSeedSlip($shopId, (int) $order->id, $slipId, 'invalid-corrective-record', 'corrective-nonretryable-key', 'accepted');
PVFPrestaShopAutomation::handleOrderSlip($module, array('order' => $order, 'orderSlipCreated' => $slip));
pvfNativeAssertPreserved(
    pvfNativeSlipRow($shopId, $slipId),
    'invalid-corrective-record',
    'corrective-nonretryable-key',
    'blocked',
    'corrective.existing-nonretryable-no-reissue'
);
$passed[] = 'corrective.existing-nonretryable-no-reissue';

sort($passed);
$expected = $required;
sort($expected);
if ($passed !== $expected) {
    pvfNativeFail('PRESTA_NATIVE_SCENARIOS_INCOMPLETE', 'PrestaShop did not execute the full native reconciliation v2 fixture.', array(
        'expected' => $expected,
        'passed' => $passed,
    ));
}

Configuration::updateValue(PVFPrestaShopAutomation::CONFIG_AUTO_INVOICES, 0, false, null, $shopId);
Configuration::updateValue(PVFPrestaShopAutomation::CONFIG_AUTO_RECTIFICATIONS, 0, false, null, $shopId);

fwrite(STDOUT, json_encode(array(
    'schema_version' => 2,
    'status' => 'ok',
    'check' => 'prestashop-native-reconciliation-v2',
    'prestashop' => (string) _PS_VERSION_,
    'php' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
    'module' => (string) $module->version,
    'scenarios' => $passed,
), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
