<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

require_once __DIR__ . '/PVFPrestaShopOrderSlipPayload.php';

final class PVFPrestaShopRectifications
{
    const CONFIG_PROFILE_ID = 'PVF_RECTIFICATION_PROFILE_ID';

    public static function installSchema()
    {
        $sql = 'CREATE TABLE IF NOT EXISTS `' . _DB_PREFIX_ . 'pvf_order_slip_sync` ('
            . '`id_pvf_order_slip_sync` INT UNSIGNED NOT NULL AUTO_INCREMENT,'
            . '`id_shop` INT UNSIGNED NOT NULL,'
            . '`id_order` INT UNSIGNED NOT NULL,'
            . '`id_order_slip` INT UNSIGNED NOT NULL,'
            . '`record_id` VARCHAR(96) NOT NULL DEFAULT \'\','
            . '`idempotency_key` VARCHAR(255) NOT NULL DEFAULT \'\','
            . '`status` VARCHAR(64) NOT NULL DEFAULT \'new\','
            . '`last_error` TEXT NULL,'
            . '`date_upd` DATETIME NOT NULL,'
            . 'PRIMARY KEY (`id_pvf_order_slip_sync`),'
            . 'UNIQUE KEY `pvf_shop_slip` (`id_shop`, `id_order_slip`),'
            . 'KEY `pvf_shop_order_slips` (`id_shop`, `id_order`)'
            . ') ENGINE=' . _MYSQL_ENGINE_ . ' DEFAULT CHARSET=utf8mb4;';

        return (bool) Db::getInstance()->execute($sql);
    }

    public static function uninstall()
    {
        Configuration::deleteByName(self::CONFIG_PROFILE_ID);
        return (bool) Db::getInstance()->execute('DROP TABLE IF EXISTS `' . _DB_PREFIX_ . 'pvf_order_slip_sync`');
    }

    public static function handleSubmissions(Module $module)
    {
        $output = '';
        if (Tools::isSubmit('submitPuenteVerifactuRectificationSettings')) {
            $profileId = trim((string) Tools::getValue(self::CONFIG_PROFILE_ID));
            if ($profileId === '') {
                $output .= $module->displayError($module->l('A separate corrective MappingProfile ID is required.'));
            } else {
                Configuration::updateValue(
                    self::CONFIG_PROFILE_ID,
                    $profileId,
                    false,
                    null,
                    (int) Context::getContext()->shop->id
                );
                $output .= $module->displayConfirmation($module->l('Corrective MappingProfile saved. Fiscal rectification rules remain server-side.'));
            }
        }

        if (Tools::isSubmit('submitPuenteVerifactuRectificationPreflight')) {
            $output .= self::runManualAction($module, 'preflight');
        } elseif (Tools::isSubmit('submitPuenteVerifactuRectificationSend')) {
            $output .= self::runManualAction($module, 'send');
        } elseif (Tools::isSubmit('submitPuenteVerifactuRectificationReconcile')) {
            $output .= self::runManualAction($module, 'reconcile');
        }

        return $output;
    }

    public static function renderPanel(Module $module)
    {
        $shopId = (int) Context::getContext()->shop->id;
        $profileId = (string) Configuration::get(self::CONFIG_PROFILE_ID, null, null, $shopId);
        $slipId = (int) Tools::getValue('PVF_ORDER_SLIP_ID');
        $row = $slipId > 0 ? self::getSyncRow($shopId, $slipId) : null;
        $action = Context::getContext()->link->getAdminLink('AdminModules', true, array(), array(
            'configure' => $module->name,
            'tab_module' => $module->tab,
            'module_name' => $module->name,
        ));

        $statusHtml = '';
        if (is_array($row)) {
            $summary = PVFPrestaShopAdminStatus::summarize($row);
            $statusHtml .= '<hr><p><strong>' . $module->l('Corrective local status:') . '</strong> '
                . Tools::safeOutput($summary['status']) . '</p>';
            if ($summary['record_id'] !== '') {
                $statusHtml .= '<p><strong>' . $module->l('Corrective Puente record:') . '</strong> '
                    . Tools::safeOutput($summary['record_id']) . '</p>';
            }
            if ($summary['last_error'] !== '') {
                $statusHtml .= '<div class="alert alert-warning">' . Tools::safeOutput($summary['last_error']) . '</div>';
            }
        }

        return '<div class="panel">'
            . '<h3><i class="icon-refresh"></i> ' . $module->l('Corrective credit slips') . '</h3>'
            . '<p>' . $module->l('PrestaShop supplies the native credit-slip facts. The server-side corrective MappingProfile decides R1–R5 and S/I; this module never does.') . '</p>'
            . '<form method="post" action="' . Tools::safeOutput($action) . '">'
            . '<div class="form-group"><label>' . $module->l('Corrective MappingProfile ID') . '</label>'
            . '<input class="form-control fixed-width-xxl" type="text" name="' . self::CONFIG_PROFILE_ID . '" value="'
            . Tools::safeOutput($profileId) . '" required></div>'
            . '<button class="btn btn-default" name="submitPuenteVerifactuRectificationSettings" type="submit">'
            . $module->l('Save corrective profile') . '</button>'
            . '</form><hr>'
            . '<form method="post" action="' . Tools::safeOutput($action) . '">'
            . '<div class="form-group"><label>' . $module->l('PrestaShop credit slip ID') . '</label>'
            . '<input class="form-control fixed-width-xl" type="number" min="1" name="PVF_ORDER_SLIP_ID" value="' . (int) $slipId . '" required></div>'
            . '<button class="btn btn-default" name="submitPuenteVerifactuRectificationPreflight" type="submit">' . $module->l('1. Corrective preflight') . '</button> '
            . '<button class="btn btn-primary" name="submitPuenteVerifactuRectificationSend" type="submit">' . $module->l('2. Create corrective record') . '</button> '
            . '<button class="btn btn-default" name="submitPuenteVerifactuRectificationReconcile" type="submit">' . $module->l('3. Refresh corrective status') . '</button>'
            . '</form>' . $statusHtml . '</div>';
    }

    public static function renderOrderStatus(Module $module, $orderId)
    {
        $shopId = (int) Context::getContext()->shop->id;
        $rows = Db::getInstance()->executeS(
            'SELECT * FROM `' . _DB_PREFIX_ . 'pvf_order_slip_sync` WHERE `id_shop` = ' . $shopId
            . ' AND `id_order` = ' . (int) $orderId . ' ORDER BY `id_order_slip` ASC'
        );
        if (!is_array($rows) || count($rows) === 0) {
            return '';
        }

        $html = '<div class="card mt-2"><h3 class="card-header"><i class="material-icons">receipt_long</i> '
            . $module->l('Puente VeriFactu corrective records') . '</h3><div class="card-body"><ul class="list-unstyled mb-0">';
        foreach ($rows as $row) {
            $summary = PVFPrestaShopAdminStatus::summarize($row);
            $badge = self::badgeClass($summary['level']);
            $html .= '<li class="mb-2"><span class="badge ' . Tools::safeOutput($badge) . '">● '
                . Tools::safeOutput(self::levelLabel($module, $summary['level'])) . '</span> '
                . '<strong>' . $module->l('Credit slip') . ' #' . (int) $row['id_order_slip'] . '</strong>';
            if ($summary['status'] !== '') {
                $html .= ' — ' . Tools::safeOutput($summary['status']);
            }
            if ($summary['record_id'] !== '') {
                $html .= ' — ' . Tools::safeOutput($summary['record_id']);
            }
            if ($summary['last_error'] !== '') {
                $html .= '<div class="text-warning">' . Tools::safeOutput($summary['last_error']) . '</div>';
            }
            $html .= '</li>';
        }
        return $html . '</ul></div></div>';
    }

    private static function runManualAction(Module $module, $action)
    {
        $slipId = (int) Tools::getValue('PVF_ORDER_SLIP_ID');
        if ($slipId <= 0) {
            return $module->displayError($module->l('Enter a valid PrestaShop credit slip ID.'));
        }

        $slip = new OrderSlip($slipId);
        if (!Validate::isLoadedObject($slip)) {
            return $module->displayError($module->l('The PrestaShop credit slip could not be loaded.'));
        }
        $order = new Order((int) $slip->id_order);
        if (!Validate::isLoadedObject($order)) {
            return $module->displayError($module->l('The parent order could not be loaded.'));
        }

        $shopId = (int) Context::getContext()->shop->id;
        if ((int) $order->id_shop !== $shopId) {
            return $module->displayError($module->l('The credit slip does not belong to the current shop context.'));
        }

        try {
            $settings = self::settings($module, $shopId);
            if ($settings['profile_id'] === '') {
                throw new RuntimeException('A separate corrective MappingProfile must be configured first.');
            }
            $original = Db::getInstance()->getRow(
                'SELECT * FROM `' . _DB_PREFIX_ . 'pvf_order_sync` WHERE `id_shop` = ' . $shopId
                . ' AND `id_order` = ' . (int) $order->id
            );
            if (!is_array($original) || empty($original['record_id'])) {
                throw new RuntimeException('The original invoice must have a Puente VeriFactu record before a corrective credit slip can be processed.');
            }

            $client = new PVFPrestaShopClient($settings);
            if ($action === 'reconcile') {
                $row = self::getSyncRow($shopId, $slipId);
                if (!is_array($row) || empty($row['record_id'])) {
                    throw new RuntimeException('No Puente VeriFactu corrective record is stored for this credit slip.');
                }
                $result = $client->status((string) $row['record_id']);
                $status = isset($result['status']) ? (string) $result['status'] : 'unknown';
                self::saveSync($shopId, (int) $order->id, $slipId, (string) $row['record_id'], (string) $row['idempotency_key'], $status, '');
                return $module->displayConfirmation($module->l('Corrective Puente VeriFactu status refreshed: ') . Tools::safeOutput($status));
            }

            $payload = PVFPrestaShopOrderSlipPayload::build($slip, $order, array('shop_id' => $shopId));
            $idempotencyKey = self::idempotencyKey($shopId, $slip, $payload);
            $preflight = $client->preflight($payload);
            if (empty($preflight['ok'])) {
                self::saveSync($shopId, (int) $order->id, $slipId, '', $idempotencyKey, 'blocked', 'Corrective preflight blocked');
                return $module->displayError($module->l('Corrective preflight found data that must be corrected. Nothing was sent.'));
            }
            if ($action === 'preflight') {
                self::saveSync($shopId, (int) $order->id, $slipId, '', $idempotencyKey, 'preflight_valid', '');
                return $module->displayConfirmation($module->l('Corrective preflight passed. Nothing was sent to AEAT.'));
            }

            $existing = self::getSyncRow($shopId, $slipId);
            if (is_array($existing) && !empty($existing['record_id'])) {
                return $module->displayWarning($module->l('This credit slip already has a Puente VeriFactu corrective record. Refresh its status instead of creating another one.'));
            }

            $result = $client->issue($payload, $idempotencyKey);
            if (empty($result['recordId'])) {
                throw new RuntimeException('Puente VeriFactu did not return a corrective record ID.');
            }
            $status = isset($result['status']) ? (string) $result['status'] : 'created';
            self::saveSync($shopId, (int) $order->id, $slipId, (string) $result['recordId'], $idempotencyKey, $status, '');
            return $module->displayConfirmation($module->l('Puente VeriFactu created corrective record: ') . Tools::safeOutput((string) $result['recordId']));
        } catch (Exception $exception) {
            self::saveSync($shopId, (int) $order->id, $slipId, '', '', 'blocked', self::safeMessage($exception));
            return $module->displayError(self::safeMessage($exception));
        }
    }

    private static function settings(Module $module, $shopId)
    {
        return array(
            'endpoint' => (string) Configuration::get('PVF_ENDPOINT', null, null, $shopId),
            'profile_id' => (string) Configuration::get(self::CONFIG_PROFILE_ID, null, null, $shopId),
            'token' => PVFPrestaShopSecretStore::get($shopId),
            'request_timeout' => (int) Configuration::get('PVF_TIMEOUT', null, null, $shopId),
            'module_version' => (string) $module->version,
            'shop_url' => Context::getContext()->shop->getBaseURL(true),
            'shop_id' => (int) $shopId,
        );
    }

    private static function idempotencyKey($shopId, OrderSlip $slip, array $payload)
    {
        return 'prestashop:' . (int) $shopId . ':order-slip:' . (int) $slip->id
            . ':number:' . rawurlencode((string) $payload['refund_invoice_number']);
    }

    private static function getSyncRow($shopId, $slipId)
    {
        $row = Db::getInstance()->getRow(
            'SELECT * FROM `' . _DB_PREFIX_ . 'pvf_order_slip_sync` WHERE `id_shop` = ' . (int) $shopId
            . ' AND `id_order_slip` = ' . (int) $slipId
        );
        return is_array($row) ? $row : null;
    }

    private static function saveSync($shopId, $orderId, $slipId, $recordId, $idempotencyKey, $status, $lastError)
    {
        $existing = self::getSyncRow($shopId, $slipId);
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
            . (int) $shopId . ',' . (int) $orderId . ',' . (int) $slipId . ',\''
            . pSQL((string) $recordId) . '\',\'' . pSQL((string) $idempotencyKey) . '\',\''
            . pSQL((string) $status) . '\',\'' . pSQL((string) $lastError, true) . '\',NOW()) '
            . 'ON DUPLICATE KEY UPDATE '
            . '`id_order`=VALUES(`id_order`),`record_id`=VALUES(`record_id`),'
            . '`idempotency_key`=VALUES(`idempotency_key`),`status`=VALUES(`status`),'
            . '`last_error`=VALUES(`last_error`),`date_upd`=NOW()'
        );
    }

    private static function badgeClass($level)
    {
        $classes = array(
            'green' => 'badge-success',
            'amber' => 'badge-warning',
            'red' => 'badge-danger',
            'gray' => 'badge-secondary',
        );
        return isset($classes[$level]) ? $classes[$level] : 'badge-warning';
    }

    private static function levelLabel(Module $module, $level)
    {
        if ($level === 'green') {
            return $module->l('Synced');
        }
        if ($level === 'red') {
            return $module->l('Action required');
        }
        if ($level === 'gray') {
            return $module->l('Not sent');
        }
        return $module->l('Pending / review');
    }

    private static function safeMessage(Exception $exception)
    {
        return Tools::safeOutput(substr((string) $exception->getMessage(), 0, 500));
    }
}
