<?php

require '/var/www/html/config/config.inc.php';

function pvfRectFail($code, $message)
{
    fwrite(STDERR, json_encode(array(
        'schema_version' => 1,
        'status' => 'failed',
        'code' => $code,
        'message' => $message,
    ), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit(1);
}

function pvfRectHydrateContext(Order $order)
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
        pvfRectFail('PRESTA_RECT_CONTEXT_INIT_FAILED', 'Could not hydrate PrestaShop CLI context for corrective smoke.');
    }
}

$expectedPs = (string) getenv('EXPECTED_PS_VERSION');
$expectedPhp = (string) getenv('EXPECTED_PHP_VERSION');
$actualPhp = PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;
if ((string) _PS_VERSION_ !== $expectedPs || $actualPhp !== $expectedPhp) {
    pvfRectFail('PRESTA_RECT_RUNTIME_MISMATCH', 'Unexpected PrestaShop/PHP runtime.');
}

$module = Module::getInstanceByName('puenteverifactu');
if (!$module || empty($module->active) || (string) $module->version !== '0.4.0') {
    pvfRectFail('PRESTA_RECT_MODULE_INVALID', 'Puente VeriFactu 0.4.0 must be active.');
}
if (!$module->isRegisteredInHook('actionOrderSlipAdd')) {
    pvfRectFail('PRESTA_RECT_AUTO_HOOK_MISSING', 'actionOrderSlipAdd must be registered.');
}
if (!class_exists('PVFPrestaShopOrderSlipPayload')
    || !class_exists('PVFPrestaShopRectifications')
    || !class_exists('PVFPrestaShopAutomation')
    || !class_exists('PVFPrestaShopApiException')) {
    pvfRectFail('PRESTA_RECT_RUNTIME_CLASSES_MISSING', 'Corrective/native reconciliation runtime classes were not loaded.');
}

$table = _DB_PREFIX_ . 'pvf_order_slip_sync';
$tableExists = (int) Db::getInstance()->getValue(
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '" . pSQL($table) . "'"
);
if ($tableExists !== 1) {
    pvfRectFail('PRESTA_RECT_SYNC_TABLE_MISSING', 'Corrective synchronization table was not created.');
}

$orderId = (int) Db::getInstance()->getValue(
    'SELECT oi.`id_order` FROM `' . _DB_PREFIX_ . 'order_invoice` oi '
    . 'INNER JOIN `' . _DB_PREFIX_ . 'order_detail` od ON od.`id_order` = oi.`id_order` '
    . 'WHERE oi.`number` > 0 AND od.`product_quantity` > od.`product_quantity_refunded` '
    . 'GROUP BY oi.`id_order` HAVING COUNT(DISTINCT oi.`id_order_invoice`) = 1 '
    . 'ORDER BY oi.`id_order` ASC'
);
if ($orderId <= 0) {
    pvfRectFail('PRESTA_RECT_ELIGIBLE_ORDER_MISSING', 'No invoiced order with refundable quantity is available in the real PrestaShop seed.');
}

$order = new Order($orderId);
if (!Validate::isLoadedObject($order)) {
    pvfRectFail('PRESTA_RECT_ORDER_INVALID', 'Corrective smoke order could not be loaded.');
}
pvfRectHydrateContext($order);

if ((int) Configuration::get(PVFPrestaShopAutomation::CONFIG_AUTO_RECTIFICATIONS, null, null, (int) $order->id_shop) !== 0) {
    pvfRectFail('PRESTA_RECT_AUTOMATION_DEFAULT_NOT_OFF', 'Corrective automation must be disabled by default.');
}

$detail = Db::getInstance()->getRow(
    'SELECT * FROM `' . _DB_PREFIX_ . 'order_detail` WHERE `id_order` = ' . (int) $order->id
    . ' AND `product_quantity` > `product_quantity_refunded` ORDER BY `id_order_detail` ASC'
);
if (!is_array($detail) || empty($detail['id_order_detail'])) {
    pvfRectFail('PRESTA_RECT_ORDER_DETAIL_MISSING', 'No refundable order detail is available.');
}

$orderDetail = new OrderDetail((int) $detail['id_order_detail']);
if (!Validate::isLoadedObject($orderDetail)) {
    pvfRectFail('PRESTA_RECT_ORDER_DETAIL_INVALID', 'Refundable order detail could not be loaded.');
}

$calculator = $orderDetail->getTaxCalculator();
if (!($calculator instanceof TaxCalculator)) {
    pvfRectFail('PRESTA_RECT_TAX_CALCULATOR_MISSING', 'Historical order-detail TaxCalculator could not be loaded.');
}
$expectedRate = PVFPrestaShopTaxBreakdown::rate($calculator->getTotalRate());

$beforeSlipId = (int) Db::getInstance()->getValue(
    'SELECT COALESCE(MAX(`id_order_slip`), 0) FROM `' . _DB_PREFIX_ . 'order_slip` WHERE `id_order` = ' . (int) $order->id
);

$productList = array(
    (int) $orderDetail->id => array(
        'id_order_detail' => (int) $orderDetail->id,
        'quantity' => 1,
        'unit_price' => (float) $orderDetail->unit_price_tax_excl,
        'amount' => (float) $orderDetail->unit_price_tax_incl,
    ),
);

try {
    $created = OrderSlip::create($order, $productList, false);
} catch (Exception $exception) {
    pvfRectFail('PRESTA_RECT_ORDER_SLIP_CREATE_EXCEPTION', $exception->getMessage());
}
if (!$created) {
    pvfRectFail('PRESTA_RECT_ORDER_SLIP_CREATE_FAILED', 'Native OrderSlip::create() returned false.');
}

$slipId = (int) Db::getInstance()->getValue(
    'SELECT MAX(`id_order_slip`) FROM `' . _DB_PREFIX_ . 'order_slip` WHERE `id_order` = ' . (int) $order->id
);
if ($slipId <= $beforeSlipId) {
    pvfRectFail('PRESTA_RECT_ORDER_SLIP_ID_MISSING', 'Native credit slip was not persisted.');
}

$autoRows = (int) Db::getInstance()->getValue(
    'SELECT COUNT(*) FROM `' . _DB_PREFIX_ . 'pvf_order_slip_sync` WHERE `id_shop` = ' . (int) $order->id_shop
    . ' AND `id_order_slip` = ' . $slipId
);
if ($autoRows !== 0) {
    pvfRectFail('PRESTA_RECT_AUTOMATION_DEFAULT_SIDE_EFFECT', 'Disabled corrective automation created local synchronization state.');
}

$slip = new OrderSlip($slipId);
if (!Validate::isLoadedObject($slip)) {
    pvfRectFail('PRESTA_RECT_ORDER_SLIP_INVALID', 'Native credit slip could not be loaded.');
}

try {
    $payload = PVFPrestaShopOrderSlipPayload::build($slip, $order, array('shop_id' => (int) $order->id_shop));
} catch (Exception $exception) {
    pvfRectFail('PRESTA_RECT_PAYLOAD_BUILD_FAILED', $exception->getMessage());
}

if ((string) $payload['source_invoice_id'] !== 'prestashop:' . (int) $order->id_shop . ':order-slip:' . $slipId) {
    pvfRectFail('PRESTA_RECT_SOURCE_ID_INVALID', 'Corrective source identity is not stable.');
}
if (empty($payload['refund_invoice_number']) || empty($payload['refund_date'])) {
    pvfRectFail('PRESTA_RECT_FISCAL_IDENTITY_MISSING', 'Corrective payload misses credit-slip number or date.');
}
if (empty($payload['original_invoice_number']) || empty($payload['original_invoice_date'])) {
    pvfRectFail('PRESTA_RECT_ORIGINAL_REFERENCE_MISSING', 'Corrective payload misses original invoice reference.');
}
if (strpos((string) $payload['total_amount'], '-') !== 0 || strpos((string) $payload['tax_amount'], '-') !== 0 && (string) $payload['tax_amount'] !== '0.00') {
    pvfRectFail('PRESTA_RECT_TOTAL_SIGN_INVALID', 'Corrective totals must reduce the original invoice.');
}
if (empty($payload['tax_lines']) || !is_array($payload['tax_lines'])) {
    pvfRectFail('PRESTA_RECT_TAX_LINES_MISSING', 'Corrective payload has no tax lines.');
}

$matchedRate = false;
foreach ($payload['tax_lines'] as $line) {
    if ((float) $line['baseAmount'] > 0.0 || (float) $line['taxAmount'] > 0.0) {
        pvfRectFail('PRESTA_RECT_TAX_LINE_SIGN_INVALID', 'Corrective tax lines must not increase the original invoice.');
    }
    if ((string) $line['rate'] === (string) $expectedRate) {
        $matchedRate = true;
    }
}
if (!$matchedRate) {
    pvfRectFail('PRESTA_RECT_NATIVE_RATE_NOT_PRESERVED', 'Corrective payload did not preserve the original OrderDetail tax rate.');
}

Db::getInstance()->delete(
    'pvf_order_slip_sync',
    '`id_shop` = ' . (int) $order->id_shop . ' AND `id_order_slip` = ' . $slipId
);
if (!Db::getInstance()->insert('pvf_order_slip_sync', array(
    'id_shop' => (int) $order->id_shop,
    'id_order' => (int) $order->id,
    'id_order_slip' => $slipId,
    'record_id' => 'corrective-smoke-record',
    'idempotency_key' => 'prestashop:' . (int) $order->id_shop . ':order-slip:' . $slipId . ':number:' . rawurlencode((string) $payload['refund_invoice_number']),
    'status' => 'accepted',
    'last_error' => '',
    'date_upd' => date('Y-m-d H:i:s'),
))) {
    pvfRectFail('PRESTA_RECT_STATUS_SEED_FAILED', 'Could not seed corrective synchronization state.');
}

$statusHtml = $module->hookDisplayAdminOrderMainBottom(array('id_order' => (int) $order->id));
if (strpos($statusHtml, 'corrective-smoke-record') === false || strpos($statusHtml, 'badge-success') === false) {
    pvfRectFail('PRESTA_RECT_STATUS_RENDER_FAILED', 'Corrective accepted state did not render in the native order page.');
}

// Connector Contract Suite v2 — native reconciliation/fallback scenarios.
$nativeScenarios = array(
    'invoice.existing-retryable-no-reissue',
    'invoice.existing-nonretryable-no-reissue',
    'invoice.new-retryable-idempotency-stable',
    'corrective.existing-retryable-no-reissue',
    'corrective.existing-nonretryable-no-reissue',
    'corrective.new-retryable-idempotency-stable',
);
$nativePassed = array();
$shopId = (int) $order->id_shop;

$getOrderSync = function () use ($shopId, $order) {
    $row = Db::getInstance()->getRow(
        'SELECT * FROM `' . _DB_PREFIX_ . 'pvf_order_sync` WHERE `id_shop` = ' . $shopId
        . ' AND `id_order` = ' . (int) $order->id
    );
    return is_array($row) ? $row : null;
};
$getSlipSync = function () use ($shopId, $slipId) {
    $row = Db::getInstance()->getRow(
        'SELECT * FROM `' . _DB_PREFIX_ . 'pvf_order_slip_sync` WHERE `id_shop` = ' . $shopId
        . ' AND `id_order_slip` = ' . (int) $slipId
    );
    return is_array($row) ? $row : null;
};
$seedOrderSync = function ($recordId, $key, $status) use ($shopId, $order) {
    return Db::getInstance()->execute(
        'INSERT INTO `' . _DB_PREFIX_ . 'pvf_order_sync` '
        . '(`id_shop`,`id_order`,`record_id`,`idempotency_key`,`status`,`last_error`,`date_upd`) VALUES ('
        . $shopId . ',' . (int) $order->id . ',\'' . pSQL((string) $recordId) . '\',\''
        . pSQL((string) $key) . '\',\'' . pSQL((string) $status) . '\',\'\',NOW()) '
        . 'ON DUPLICATE KEY UPDATE `record_id`=VALUES(`record_id`),`idempotency_key`=VALUES(`idempotency_key`),'
        . '`status`=VALUES(`status`),`last_error`=\'\',`date_upd`=NOW()'
    );
};
$seedSlipSync = function ($recordId, $key, $status) use ($shopId, $order, $slipId) {
    return Db::getInstance()->execute(
        'INSERT INTO `' . _DB_PREFIX_ . 'pvf_order_slip_sync` '
        . '(`id_shop`,`id_order`,`id_order_slip`,`record_id`,`idempotency_key`,`status`,`last_error`,`date_upd`) VALUES ('
        . $shopId . ',' . (int) $order->id . ',' . (int) $slipId . ',\'' . pSQL((string) $recordId) . '\',\''
        . pSQL((string) $key) . '\',\'' . pSQL((string) $status) . '\',\'\',NOW()) '
        . 'ON DUPLICATE KEY UPDATE `id_order`=VALUES(`id_order`),`record_id`=VALUES(`record_id`),'
        . '`idempotency_key`=VALUES(`idempotency_key`),`status`=VALUES(`status`),'
        . '`last_error`=\'\',`date_upd`=NOW()'
    );
};
$assertState = function ($row, $recordId, $key, $status, $scenario) {
    if (!is_array($row)
        || (string) $row['record_id'] !== (string) $recordId
        || (string) $row['idempotency_key'] !== (string) $key
        || (string) $row['status'] !== (string) $status) {
        pvfRectFail('PRESTA_NATIVE_RECONCILIATION_FAILED', 'Native reconciliation v2 scenario failed: ' . $scenario);
    }
};

Configuration::updateValue('PVF_ENDPOINT', 'https://127.0.0.1:1', false, null, $shopId);
Configuration::updateValue('PVF_PROFILE_ID', 'native-contract-invoice', false, null, $shopId);
Configuration::updateValue(PVFPrestaShopRectifications::CONFIG_PROFILE_ID, 'native-contract-corrective', false, null, $shopId);
Configuration::updateValue('PVF_TIMEOUT', 5, false, null, $shopId);
Configuration::updateValue(PVFPrestaShopAutomation::CONFIG_AUTO_INVOICES, 1, false, null, $shopId);
Configuration::updateValue(PVFPrestaShopAutomation::CONFIG_AUTO_RECTIFICATIONS, 1, false, null, $shopId);
PVFPrestaShopSecretStore::set('native-contract-token', $shopId);

// New invoice + retryable transport failure: retry must keep the same deterministic idempotency key.
Db::getInstance()->delete('pvf_order_sync', '`id_shop` = ' . $shopId . ' AND `id_order` = ' . (int) $order->id);
PVFPrestaShopAutomation::handleOrderStatus($module, array('id_order' => (int) $order->id));
$invoiceRetryOne = $getOrderSync();
if (!is_array($invoiceRetryOne)
    || (string) $invoiceRetryOne['status'] !== 'retry_pending'
    || (string) $invoiceRetryOne['record_id'] !== ''
    || (string) $invoiceRetryOne['idempotency_key'] === '') {
    pvfRectFail('PRESTA_NATIVE_INVOICE_RETRY_STATE', 'New invoice retry state is invalid.');
}
$invoiceRetryKey = (string) $invoiceRetryOne['idempotency_key'];
PVFPrestaShopAutomation::handleOrderStatus($module, array('id_order' => (int) $order->id));
$invoiceRetryTwo = $getOrderSync();
if (!is_array($invoiceRetryTwo) || (string) $invoiceRetryTwo['idempotency_key'] !== $invoiceRetryKey) {
    pvfRectFail('PRESTA_NATIVE_INVOICE_RETRY_KEY', 'New invoice retry changed the idempotency key.');
}
$nativePassed[] = 'invoice.new-retryable-idempotency-stable';

// Existing invoice + retryable status failure: identity must survive and no issue fallback may replace its key.
$seedOrderSync('fr_abc123', 'invoice-existing-key', 'accepted');
PVFPrestaShopAutomation::handleOrderStatus($module, array('id_order' => (int) $order->id));
$assertState($getOrderSync(), 'fr_abc123', 'invoice-existing-key', 'retry_pending', 'invoice.existing-retryable-no-reissue');
$nativePassed[] = 'invoice.existing-retryable-no-reissue';

// Existing invoice + nonretryable invalid record: blocked, identity preserved, no issue fallback.
$seedOrderSync('invalid-existing-record', 'invoice-nonretryable-key', 'accepted');
PVFPrestaShopAutomation::handleOrderStatus($module, array('id_order' => (int) $order->id));
$assertState($getOrderSync(), 'invalid-existing-record', 'invoice-nonretryable-key', 'blocked', 'invoice.existing-nonretryable-no-reissue');
$nativePassed[] = 'invoice.existing-nonretryable-no-reissue';

// Correctives need an original fiscal record before any new issue attempt.
$seedOrderSync('fr_abcd01', 'original-invoice-key', 'accepted');

// New corrective + retryable transport failure keeps one stable key.
Db::getInstance()->delete('pvf_order_slip_sync', '`id_shop` = ' . $shopId . ' AND `id_order_slip` = ' . $slipId);
PVFPrestaShopAutomation::handleOrderSlip($module, array('order' => $order, 'orderSlipCreated' => $slip));
$slipRetryOne = $getSlipSync();
if (!is_array($slipRetryOne)
    || (string) $slipRetryOne['status'] !== 'retry_pending'
    || (string) $slipRetryOne['record_id'] !== ''
    || (string) $slipRetryOne['idempotency_key'] === '') {
    pvfRectFail('PRESTA_NATIVE_CORRECTIVE_RETRY_STATE', 'New corrective retry state is invalid.');
}
$slipRetryKey = (string) $slipRetryOne['idempotency_key'];
PVFPrestaShopAutomation::handleOrderSlip($module, array('order' => $order, 'orderSlipCreated' => $slip));
$slipRetryTwo = $getSlipSync();
if (!is_array($slipRetryTwo) || (string) $slipRetryTwo['idempotency_key'] !== $slipRetryKey) {
    pvfRectFail('PRESTA_NATIVE_CORRECTIVE_RETRY_KEY', 'New corrective retry changed the idempotency key.');
}
$nativePassed[] = 'corrective.new-retryable-idempotency-stable';

// Existing corrective + retryable status failure.
$seedSlipSync('fr_abc456', 'corrective-existing-key', 'accepted');
PVFPrestaShopAutomation::handleOrderSlip($module, array('order' => $order, 'orderSlipCreated' => $slip));
$assertState($getSlipSync(), 'fr_abc456', 'corrective-existing-key', 'retry_pending', 'corrective.existing-retryable-no-reissue');
$nativePassed[] = 'corrective.existing-retryable-no-reissue';

// Existing corrective + nonretryable invalid record.
$seedSlipSync('invalid-corrective-record', 'corrective-nonretryable-key', 'accepted');
PVFPrestaShopAutomation::handleOrderSlip($module, array('order' => $order, 'orderSlipCreated' => $slip));
$assertState($getSlipSync(), 'invalid-corrective-record', 'corrective-nonretryable-key', 'blocked', 'corrective.existing-nonretryable-no-reissue');
$nativePassed[] = 'corrective.existing-nonretryable-no-reissue';

sort($nativeScenarios);
sort($nativePassed);
if ($nativePassed !== $nativeScenarios) {
    pvfRectFail('PRESTA_NATIVE_SCENARIOS_INCOMPLETE', 'PrestaShop did not pass every native reconciliation v2 scenario.');
}

Configuration::updateValue(PVFPrestaShopAutomation::CONFIG_AUTO_INVOICES, 0, false, null, $shopId);
Configuration::updateValue(PVFPrestaShopAutomation::CONFIG_AUTO_RECTIFICATIONS, 0, false, null, $shopId);

fwrite(STDOUT, json_encode(array(
    'schema_version' => 2,
    'status' => 'ok',
    'check' => 'prestashop-real-corrective-and-native-reconciliation-v2',
    'prestashop' => (string) _PS_VERSION_,
    'php' => $actualPhp,
    'module' => (string) $module->version,
    'order_id' => (int) $order->id,
    'order_slip_id' => $slipId,
    'native_tax_rate' => $expectedRate,
    'tax_lines' => count($payload['tax_lines']),
    'corrective_status_card' => true,
    'automation_default_off' => true,
    'native_reconciliation_v2' => $nativePassed,
), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
