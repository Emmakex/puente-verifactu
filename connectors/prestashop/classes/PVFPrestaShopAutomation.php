<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

final class PVFPrestaShopAutomation
{
    const CONFIG_AUTO_INVOICES = 'PVF_AUTO_INVOICES';
    const CONFIG_AUTO_RECTIFICATIONS = 'PVF_AUTO_RECTIFICATIONS';

    public static function installDefaults($shopId)
    {
        return Configuration::updateValue(self::CONFIG_AUTO_INVOICES, 0, false, null, (int) $shopId)
            && Configuration::updateValue(self::CONFIG_AUTO_RECTIFICATIONS, 0, false, null, (int) $shopId);
    }

    public static function uninstall()
    {
        Configuration::deleteByName(self::CONFIG_AUTO_INVOICES);
        Configuration::deleteByName(self::CONFIG_AUTO_RECTIFICATIONS);
        return true;
    }

    public static function handleOrderStatus(Module $module, array $params)
    {
        $orderId = isset($params['id_order']) ? (int) $params['id_order'] : 0;
        if ($orderId <= 0) {
            return;
        }

        $order = new Order($orderId);
        if (!Validate::isLoadedObject($order)) {
            return;
        }
        $shopId = (int) $order->id_shop;
        if (!self::enabled(self::CONFIG_AUTO_INVOICES, $shopId)) {
            return;
        }

        $invoices = $order->getInvoicesCollection();
        if (!is_object($invoices) && !is_array($invoices)) {
            return;
        }
        if (count($invoices) !== 1) {
            return;
        }

        try {
            $existing = self::getOrderSync($shopId, $orderId);
            if (is_array($existing) && !empty($existing['record_id'])) {
                self::reconcileOrder($module, $order, $existing);
                return;
            }
            self::issueOrder($module, $order);
        } catch (Exception $exception) {
            self::saveOrderSync($order, '', '', 'blocked', self::safeMessage($exception));
        }
    }

    public static function handleOrderSlip(Module $module, array $params)
    {
        $order = isset($params['order']) && $params['order'] instanceof Order ? $params['order'] : null;
        if (!$order || !Validate::isLoadedObject($order)) {
            return;
        }
        $shopId = (int) $order->id_shop;
        if (!self::enabled(self::CONFIG_AUTO_RECTIFICATIONS, $shopId)) {
            return;
        }

        $slipId = 0;
        if (isset($params['orderSlipCreated']) && $params['orderSlipCreated'] instanceof OrderSlip) {
            $slipId = (int) $params['orderSlipCreated']->id;
        }
        if ($slipId <= 0) {
            $slipId = (int) Db::getInstance()->getValue(
                'SELECT `id_order_slip` FROM `' . _DB_PREFIX_ . 'order_slip` WHERE `id_order` = ' . (int) $order->id
                . ' ORDER BY `id_order_slip` DESC'
            );
        }
        if ($slipId <= 0) {
            return;
        }

        $slip = new OrderSlip($slipId);
        if (!Validate::isLoadedObject($slip) || (int) $slip->id_order !== (int) $order->id) {
            return;
        }

        try {
            $existing = self::getSlipSync($shopId, $slipId);
            if (is_array($existing) && !empty($existing['record_id'])) {
                self::reconcileSlip($module, $order, $slip, $existing);
                return;
            }
            self::issueSlip($module, $order, $slip);
        } catch (Exception $exception) {
            self::saveSlipSync($shopId, (int) $order->id, $slipId, '', '', 'blocked', self::safeMessage($exception));
        }
    }

    private static function issueOrder(Module $module, Order $order)
    {
        $settings = self::invoiceSettings($module, (int) $order->id_shop);
        $client = new PVFPrestaShopClient($settings);
        $payload = PVFPrestaShopOrderPayload::build($order, $settings);
        $idempotencyKey = self::orderIdempotencyKey($order, $payload);
        $preflight = $client->preflight($payload);
        if (empty($preflight['ok'])) {
            self::saveOrderSync($order, '', $idempotencyKey, 'blocked', 'Automatic preflight blocked');
            return;
        }

        $result = $client->issue($payload, $idempotencyKey);
        if (empty($result['recordId'])) {
            throw new RuntimeException('Puente VeriFactu did not return a record ID.');
        }
        $status = isset($result['status']) ? (string) $result['status'] : 'created';
        self::saveOrderSync($order, (string) $result['recordId'], $idempotencyKey, $status, '');
    }

    private static function reconcileOrder(Module $module, Order $order, array $existing)
    {
        $client = new PVFPrestaShopClient(self::invoiceSettings($module, (int) $order->id_shop));
        $result = $client->status((string) $existing['record_id']);
        $status = isset($result['status']) ? (string) $result['status'] : 'unknown';
        self::saveOrderSync($order, (string) $existing['record_id'], (string) $existing['idempotency_key'], $status, '');
    }

    private static function issueSlip(Module $module, Order $order, OrderSlip $slip)
    {
        $shopId = (int) $order->id_shop;
        $original = self::getOrderSync($shopId, (int) $order->id);
        if (!is_array($original) || empty($original['record_id'])) {
            throw new RuntimeException('The original invoice must have a Puente VeriFactu record before automatic corrective processing.');
        }

        $settings = self::rectificationSettings($module, $shopId);
        if ($settings['profile_id'] === '') {
            throw new RuntimeException('A separate corrective MappingProfile must be configured before automatic corrective processing.');
        }
        $client = new PVFPrestaShopClient($settings);
        $payload = PVFPrestaShopOrderSlipPayload::build($slip, $order, array('shop_id' => $shopId));
        $idempotencyKey = self::slipIdempotencyKey($shopId, $slip, $payload);
        $preflight = $client->preflight($payload);
        if (empty($preflight['ok'])) {
            self::saveSlipSync($shopId, (int) $order->id, (int) $slip->id, '', $idempotencyKey, 'blocked', 'Automatic corrective preflight blocked');
            return;
        }

        $result = $client->issue($payload, $idempotencyKey);
        if (empty($result['recordId'])) {
            throw new RuntimeException('Puente VeriFactu did not return a corrective record ID.');
        }
        $status = isset($result['status']) ? (string) $result['status'] : 'created';
        self::saveSlipSync($shopId, (int) $order->id, (int) $slip->id, (string) $result['recordId'], $idempotencyKey, $status, '');
    }

    private static function reconcileSlip(Module $module, Order $order, OrderSlip $slip, array $existing)
    {
        $settings = self::rectificationSettings($module, (int) $order->id_shop);
        if ($settings['profile_id'] === '') {
            return;
        }
        $client = new PVFPrestaShopClient($settings);
        $result = $client->status((string) $existing['record_id']);
        $status = isset($result['status']) ? (string) $result['status'] : 'unknown';
        self::saveSlipSync(
            (int) $order->id_shop,
            (int) $order->id,
            (int) $slip->id,
            (string) $existing['record_id'],
            (string) $existing['idempotency_key'],
            $status,
            ''
        );
    }

    private static function enabled($key, $shopId)
    {
        return (int) Configuration::get((string) $key, null, null, (int) $shopId) === 1;
    }

    private static function invoiceSettings(Module $module, $shopId)
    {
        return self::settings($module, $shopId, (string) Configuration::get('PVF_PROFILE_ID', null, null, (int) $shopId));
    }

    private static function rectificationSettings(Module $module, $shopId)
    {
        return self::settings($module, $shopId, (string) Configuration::get(PVFPrestaShopRectifications::CONFIG_PROFILE_ID, null, null, (int) $shopId));
    }

    private static function settings(Module $module, $shopId, $profileId)
    {
        $shop = new Shop((int) $shopId);
        return array(
            'endpoint' => (string) Configuration::get('PVF_ENDPOINT', null, null, (int) $shopId),
            'profile_id' => (string) $profileId,
            'token' => PVFPrestaShopSecretStore::get((int) $shopId),
            'request_timeout' => (int) Configuration::get('PVF_TIMEOUT', null, null, (int) $shopId),
            'module_version' => (string) $module->version,
            'shop_url' => Validate::isLoadedObject($shop) ? $shop->getBaseURL(true) : '',
            'shop_id' => (int) $shopId,
        );
    }

    private static function orderIdempotencyKey(Order $order, array $payload)
    {
        return 'prestashop:' . (int) $order->id_shop . ':order:' . (int) $order->id
            . ':invoice:' . rawurlencode((string) $payload['invoice_number']);
    }

    private static function slipIdempotencyKey($shopId, OrderSlip $slip, array $payload)
    {
        return 'prestashop:' . (int) $shopId . ':order-slip:' . (int) $slip->id
            . ':number:' . rawurlencode((string) $payload['refund_invoice_number']);
    }

    private static function getOrderSync($shopId, $orderId)
    {
        $row = Db::getInstance()->getRow(
            'SELECT * FROM `' . _DB_PREFIX_ . 'pvf_order_sync` WHERE `id_shop` = ' . (int) $shopId
            . ' AND `id_order` = ' . (int) $orderId
        );
        return is_array($row) ? $row : null;
    }

    private static function getSlipSync($shopId, $slipId)
    {
        $row = Db::getInstance()->getRow(
            'SELECT * FROM `' . _DB_PREFIX_ . 'pvf_order_slip_sync` WHERE `id_shop` = ' . (int) $shopId
            . ' AND `id_order_slip` = ' . (int) $slipId
        );
        return is_array($row) ? $row : null;
    }

    private static function saveOrderSync(Order $order, $recordId, $idempotencyKey, $status, $lastError)
    {
        $existing = self::getOrderSync((int) $order->id_shop, (int) $order->id);
        if (is_array($existing)) {
            if ($recordId === '') {
                $recordId = (string) $existing['record_id'];
            }
            if ($idempotencyKey === '') {
                $idempotencyKey = (string) $existing['idempotency_key'];
            }
        }
        return Db::getInstance()->execute(
            'INSERT INTO `' . _DB_PREFIX_ . 'pvf_order_sync` '
            . '(`id_shop`,`id_order`,`record_id`,`idempotency_key`,`status`,`last_error`,`date_upd`) VALUES ('
            . (int) $order->id_shop . ',' . (int) $order->id . ',\'' . pSQL((string) $recordId) . '\',\''
            . pSQL((string) $idempotencyKey) . '\',\'' . pSQL((string) $status) . '\',\''
            . pSQL((string) $lastError, true) . '\',NOW()) '
            . 'ON DUPLICATE KEY UPDATE `record_id`=VALUES(`record_id`),`idempotency_key`=VALUES(`idempotency_key`),'
            . '`status`=VALUES(`status`),`last_error`=VALUES(`last_error`),`date_upd`=NOW()'
        );
    }

    private static function saveSlipSync($shopId, $orderId, $slipId, $recordId, $idempotencyKey, $status, $lastError)
    {
        $existing = self::getSlipSync($shopId, $slipId);
        if (is_array($existing)) {
            if ($recordId === '') {
                $recordId = (string) $existing['record_id'];
            }
            if ($idempotencyKey === '') {
                $idempotencyKey = (string) $existing['idempotency_key'];
            }
        }
        return Db::getInstance()->execute(
            'INSERT INTO `' . _DB_PREFIX_ . 'pvf_order_slip_sync` '
            . '(`id_shop`,`id_order`,`id_order_slip`,`record_id`,`idempotency_key`,`status`,`last_error`,`date_upd`) VALUES ('
            . (int) $shopId . ',' . (int) $orderId . ',' . (int) $slipId . ',\'' . pSQL((string) $recordId) . '\',\''
            . pSQL((string) $idempotencyKey) . '\',\'' . pSQL((string) $status) . '\',\''
            . pSQL((string) $lastError, true) . '\',NOW()) '
            . 'ON DUPLICATE KEY UPDATE `id_order`=VALUES(`id_order`),`record_id`=VALUES(`record_id`),'
            . '`idempotency_key`=VALUES(`idempotency_key`),`status`=VALUES(`status`),'
            . '`last_error`=VALUES(`last_error`),`date_upd`=NOW()'
        );
    }

    private static function safeMessage(Exception $exception)
    {
        return substr(strip_tags((string) $exception->getMessage()), 0, 500);
    }
}
