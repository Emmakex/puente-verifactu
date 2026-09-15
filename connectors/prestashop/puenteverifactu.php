<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

require_once __DIR__ . '/classes/PVFPrestaShopSecretStore.php';
require_once __DIR__ . '/classes/PVFPrestaShopClient.php';
require_once __DIR__ . '/classes/PVFPrestaShopOrderPayload.php';
require_once __DIR__ . '/classes/PVFPrestaShopAdminStatus.php';
require_once __DIR__ . '/classes/PVFPrestaShopRectifications.php';

class PuenteVerifactu extends Module
{
    const VERSION = '0.3.0';
    const CONFIG_ENDPOINT = 'PVF_ENDPOINT';
    const CONFIG_PROFILE_ID = 'PVF_PROFILE_ID';
    const CONFIG_TIMEOUT = 'PVF_TIMEOUT';

    public function __construct()
    {
        $this->name = 'puenteverifactu';
        $this->tab = 'billing_invoicing';
        $this->version = self::VERSION;
        $this->author = 'Kairoseth Extensions';
        $this->need_instance = 0;
        $this->bootstrap = true;
        $this->ps_versions_compliancy = array('min' => '1.7.8.0', 'max' => '8.99.99');

        parent::__construct();

        $this->displayName = $this->l('Puente VeriFactu');
        $this->description = $this->l('Connects PrestaShop invoices to Puente VeriFactu without embedding AEAT fiscal logic in PrestaShop.');
        $this->confirmUninstall = $this->l('Uninstall the connector? Local sync metadata will be removed, but no fiscal record is deleted from Puente VeriFactu.');
    }

    public function install()
    {
        return parent::install()
            && $this->installSchema()
            && PVFPrestaShopRectifications::installSchema()
            && Configuration::updateValue(self::CONFIG_TIMEOUT, 15, false, null, (int) $this->context->shop->id)
            && $this->registerHook('displayAdminOrderMainBottom');
    }

    public function uninstall()
    {
        Configuration::deleteByName(self::CONFIG_ENDPOINT);
        Configuration::deleteByName(self::CONFIG_PROFILE_ID);
        Configuration::deleteByName(self::CONFIG_TIMEOUT);
        Configuration::deleteByName(PVFPrestaShopSecretStore::CONFIG_KEY);

        return PVFPrestaShopRectifications::uninstall()
            && $this->uninstallSchema()
            && parent::uninstall();
    }

    public function getContent()
    {
        $output = '';

        if (Tools::isSubmit('submitPuenteVerifactuSettings')) {
            $output .= $this->saveSettings();
        }

        if (Tools::isSubmit('submitPuenteVerifactuPreflight')) {
            $output .= $this->runManualAction('preflight');
        } elseif (Tools::isSubmit('submitPuenteVerifactuSend')) {
            $output .= $this->runManualAction('send');
        } elseif (Tools::isSubmit('submitPuenteVerifactuReconcile')) {
            $output .= $this->runManualAction('reconcile');
        }

        $output .= PVFPrestaShopRectifications::handleSubmissions($this);

        return $output
            . $this->renderSettingsForm()
            . $this->renderManualPanel()
            . PVFPrestaShopRectifications::renderPanel($this);
    }

    public function hookDisplayAdminOrderMainBottom($params)
    {
        $orderId = isset($params['id_order']) ? (int) $params['id_order'] : 0;
        if ($orderId <= 0) {
            return '';
        }

        $order = new Order($orderId);
        if (!Validate::isLoadedObject($order)) {
            return '';
        }
        if ((int) $order->id_shop !== (int) $this->context->shop->id) {
            return '';
        }

        $summary = PVFPrestaShopAdminStatus::summarize($this->getSyncRow($orderId));
        $labels = array(
            'green' => $this->l('Synced'),
            'amber' => $this->l('Pending / review'),
            'red' => $this->l('Action required'),
            'gray' => $this->l('Not sent'),
        );
        $badgeClasses = array(
            'green' => 'badge-success',
            'amber' => 'badge-warning',
            'red' => 'badge-danger',
            'gray' => 'badge-secondary',
        );
        $level = isset($labels[$summary['level']]) ? $summary['level'] : 'amber';
        $controlsUrl = $this->context->link->getAdminLink('AdminModules', true, array(), array(
            'configure' => $this->name,
            'tab_module' => $this->tab,
            'module_name' => $this->name,
            'PVF_ORDER_ID' => $orderId,
        ));

        $html = '<div class="card mt-2 pvf-order-status-card">'
            . '<h3 class="card-header"><i class="material-icons">verified_user</i> ' . $this->l('Puente VeriFactu') . '</h3>'
            . '<div class="card-body">'
            . '<p><span class="badge ' . Tools::safeOutput($badgeClasses[$level]) . '">● ' . Tools::safeOutput($labels[$level]) . '</span></p>';

        if ($summary['status'] === '') {
            $html .= '<p class="mb-2">' . $this->l('No Puente VeriFactu operation exists for this order yet.') . '</p>';
        } else {
            $html .= '<p class="mb-1"><strong>' . $this->l('Local status:') . '</strong> '
                . Tools::safeOutput($summary['status']) . '</p>';
        }

        if ($summary['record_id'] !== '') {
            $html .= '<p class="mb-1"><strong>' . $this->l('Puente record:') . '</strong> '
                . Tools::safeOutput($summary['record_id']) . '</p>';
        }
        if ($summary['date_upd'] !== '') {
            $html .= '<p class="mb-1"><strong>' . $this->l('Last local update:') . '</strong> '
                . Tools::safeOutput($summary['date_upd']) . '</p>';
        }
        if ($summary['last_error'] !== '') {
            $html .= '<div class="alert alert-warning mt-2 mb-2"><strong>' . $this->l('Review:') . '</strong> '
                . Tools::safeOutput($summary['last_error']) . '</div>';
        }

        $html .= '<p class="mb-0"><a class="btn btn-default" href="' . Tools::safeOutput($controlsUrl) . '">'
            . $this->l('Open VeriFactu controls') . '</a></p>'
            . '</div></div>';

        return $html . PVFPrestaShopRectifications::renderOrderStatus($this, $orderId);
    }

    private function saveSettings()
    {
        $shopId = (int) $this->context->shop->id;
        $endpoint = rtrim(trim((string) Tools::getValue('PVF_ENDPOINT')), '/');
        $profileId = trim((string) Tools::getValue('PVF_PROFILE_ID'));
        $timeout = max(5, min(30, (int) Tools::getValue('PVF_TIMEOUT', 15)));
        $token = trim((string) Tools::getValue('PVF_API_TOKEN'));

        if ($endpoint === '' || strpos($endpoint, 'https://') !== 0) {
            return $this->displayError($this->l('The Puente VeriFactu endpoint must use HTTPS.'));
        }
        if ($profileId === '') {
            return $this->displayError($this->l('A server-side MappingProfile ID is required.'));
        }

        Configuration::updateValue(self::CONFIG_ENDPOINT, $endpoint, false, null, $shopId);
        Configuration::updateValue(self::CONFIG_PROFILE_ID, $profileId, false, null, $shopId);
        Configuration::updateValue(self::CONFIG_TIMEOUT, $timeout, false, null, $shopId);

        if ($token !== '') {
            try {
                PVFPrestaShopSecretStore::set($token, $shopId);
            } catch (Exception $exception) {
                return $this->displayError($this->safeMessage($exception));
            }
        }

        return $this->displayConfirmation($this->l('Puente VeriFactu settings saved. The token is stored encrypted and is never displayed again.'));
    }

    private function renderSettingsForm()
    {
        $shopId = (int) $this->context->shop->id;
        $helper = new HelperForm();
        $helper->show_toolbar = false;
        $helper->table = $this->table;
        $helper->module = $this;
        $helper->default_form_language = (int) $this->context->language->id;
        $helper->allow_employee_form_lang = Configuration::get('PS_BO_ALLOW_EMPLOYEE_FORM_LANG');
        $helper->identifier = $this->identifier;
        $helper->submit_action = 'submitPuenteVerifactuSettings';
        $helper->currentIndex = $this->context->link->getAdminLink('AdminModules', false)
            . '&configure=' . $this->name
            . '&tab_module=' . $this->tab
            . '&module_name=' . $this->name;
        $helper->token = Tools::getAdminTokenLite('AdminModules');
        $helper->tpl_vars = array(
            'fields_value' => array(
                'PVF_ENDPOINT' => (string) Configuration::get(self::CONFIG_ENDPOINT, null, null, $shopId),
                'PVF_PROFILE_ID' => (string) Configuration::get(self::CONFIG_PROFILE_ID, null, null, $shopId),
                'PVF_TIMEOUT' => (int) Configuration::get(self::CONFIG_TIMEOUT, null, null, $shopId),
                'PVF_API_TOKEN' => '',
            ),
        );

        return $helper->generateForm(array(array(
            'form' => array(
                'legend' => array(
                    'title' => $this->l('Puente VeriFactu connection'),
                    'icon' => 'icon-lock',
                ),
                'description' => $this->l('PrestaShop only sends a neutral invoice payload. Fiscal classification, issuer data, EUR conversion and AEAT credentials remain server-side in Puente VeriFactu.'),
                'input' => array(
                    array(
                        'type' => 'text',
                        'label' => $this->l('HTTPS endpoint'),
                        'name' => 'PVF_ENDPOINT',
                        'required' => true,
                        'desc' => $this->l('Example: https://bridge.example.com. HTTP endpoints are rejected.'),
                    ),
                    array(
                        'type' => 'text',
                        'label' => $this->l('MappingProfile ID'),
                        'name' => 'PVF_PROFILE_ID',
                        'required' => true,
                        'desc' => $this->l('Server-side profile. PrestaShop never decides sensitive fiscal classifications.'),
                    ),
                    array(
                        'type' => 'password',
                        'label' => $this->l('Bearer token'),
                        'name' => 'PVF_API_TOKEN',
                        'autocomplete' => false,
                        'desc' => $this->l('Leave blank to keep the existing encrypted token.'),
                    ),
                    array(
                        'type' => 'text',
                        'label' => $this->l('Request timeout (seconds)'),
                        'name' => 'PVF_TIMEOUT',
                        'required' => true,
                        'desc' => $this->l('Allowed range: 5 to 30 seconds.'),
                    ),
                ),
                'submit' => array(
                    'title' => $this->l('Save'),
                    'class' => 'btn btn-default pull-right',
                ),
            ),
        )));
    }

    private function renderManualPanel()
    {
        $action = $this->context->link->getAdminLink('AdminModules', true, array(), array(
            'configure' => $this->name,
            'tab_module' => $this->tab,
            'module_name' => $this->name,
        ));
        $orderId = (int) Tools::getValue('PVF_ORDER_ID');
        $row = $orderId > 0 ? $this->getSyncRow($orderId) : null;
        $statusHtml = '';
        if (is_array($row)) {
            $statusHtml = '<p><strong>' . $this->l('Local status:') . '</strong> ' . Tools::safeOutput((string) $row['status']) . '</p>';
            if (!empty($row['record_id'])) {
                $statusHtml .= '<p><strong>' . $this->l('Puente record:') . '</strong> ' . Tools::safeOutput((string) $row['record_id']) . '</p>';
            }
        }

        return '<div class="panel">'
            . '<h3><i class="icon-check"></i> ' . $this->l('Manual safe flow') . '</h3>'
            . '<p>' . $this->l('Start with Preflight. It validates the order but does not create a fiscal record or send anything to AEAT.') . '</p>'
            . '<form method="post" action="' . Tools::safeOutput($action) . '">'
            . '<div class="form-group"><label>' . $this->l('PrestaShop order ID') . '</label>'
            . '<input class="form-control fixed-width-xl" type="number" min="1" name="PVF_ORDER_ID" value="' . (int) $orderId . '" required></div>'
            . '<button class="btn btn-default" name="submitPuenteVerifactuPreflight" type="submit">' . $this->l('1. Preflight only') . '</button> '
            . '<button class="btn btn-primary" name="submitPuenteVerifactuSend" type="submit">' . $this->l('2. Create fiscal record') . '</button> '
            . '<button class="btn btn-default" name="submitPuenteVerifactuReconcile" type="submit">' . $this->l('3. Refresh status') . '</button>'
            . '</form>'
            . $statusHtml
            . '</div>';
    }

    private function runManualAction($action)
    {
        $orderId = (int) Tools::getValue('PVF_ORDER_ID');
        if ($orderId <= 0) {
            return $this->displayError($this->l('Enter a valid PrestaShop order ID.'));
        }

        $order = new Order($orderId);
        if (!Validate::isLoadedObject($order)) {
            return $this->displayError($this->l('The PrestaShop order could not be loaded.'));
        }
        if ((int) $order->id_shop !== (int) $this->context->shop->id) {
            return $this->displayError($this->l('The order does not belong to the current shop context.'));
        }

        try {
            $client = new PVFPrestaShopClient($this->settings());
            if ($action === 'reconcile') {
                $row = $this->getSyncRow($orderId);
                if (!is_array($row) || empty($row['record_id'])) {
                    throw new RuntimeException('No Puente VeriFactu record is stored for this order.');
                }
                $result = $client->status((string) $row['record_id']);
                $status = isset($result['status']) ? (string) $result['status'] : 'unknown';
                $this->saveSync($order, (string) $row['record_id'], (string) $row['idempotency_key'], $status, '');
                return $this->displayConfirmation($this->l('Puente VeriFactu status refreshed: ') . Tools::safeOutput($status));
            }

            $payload = PVFPrestaShopOrderPayload::build($order, $this->settings());
            $preflight = $client->preflight($payload);
            if (empty($preflight['ok'])) {
                $this->saveSync($order, '', $this->idempotencyKey($order, $payload), 'blocked', 'Preflight blocked');
                return $this->displayError($this->l('Preflight found data that must be corrected. Nothing was sent.'));
            }
            if ($action === 'preflight') {
                $this->saveSync($order, '', $this->idempotencyKey($order, $payload), 'preflight_valid', '');
                return $this->displayConfirmation($this->l('Preflight passed. Nothing was sent to AEAT.'));
            }

            $existing = $this->getSyncRow($orderId);
            if (is_array($existing) && !empty($existing['record_id'])) {
                return $this->displayWarning($this->l('This order already has a Puente VeriFactu record. Use Refresh status instead of creating another record.'));
            }

            $idempotencyKey = $this->idempotencyKey($order, $payload);
            $result = $client->issue($payload, $idempotencyKey);
            if (empty($result['recordId'])) {
                throw new RuntimeException('Puente VeriFactu did not return a record ID.');
            }
            $status = isset($result['status']) ? (string) $result['status'] : 'created';
            $this->saveSync($order, (string) $result['recordId'], $idempotencyKey, $status, '');

            return $this->displayConfirmation($this->l('Puente VeriFactu created fiscal record: ') . Tools::safeOutput((string) $result['recordId']));
        } catch (Exception $exception) {
            $this->saveSync($order, '', '', 'blocked', $this->safeMessage($exception));
            return $this->displayError($this->safeMessage($exception));
        }
    }

    private function settings()
    {
        $shopId = (int) $this->context->shop->id;
        return array(
            'endpoint' => (string) Configuration::get(self::CONFIG_ENDPOINT, null, null, $shopId),
            'profile_id' => (string) Configuration::get(self::CONFIG_PROFILE_ID, null, null, $shopId),
            'token' => PVFPrestaShopSecretStore::get($shopId),
            'request_timeout' => (int) Configuration::get(self::CONFIG_TIMEOUT, null, null, $shopId),
            'module_version' => self::VERSION,
            'shop_url' => $this->context->shop->getBaseURL(true),
            'shop_id' => $shopId,
        );
    }

    private function idempotencyKey(Order $order, array $payload)
    {
        return 'prestashop:' . (int) $order->id_shop . ':order:' . (int) $order->id . ':invoice:' . rawurlencode((string) $payload['invoice_number']);
    }

    private function installSchema()
    {
        $sql = 'CREATE TABLE IF NOT EXISTS `' . _DB_PREFIX_ . 'pvf_order_sync` ('
            . '`id_pvf_order_sync` INT UNSIGNED NOT NULL AUTO_INCREMENT,'
            . '`id_shop` INT UNSIGNED NOT NULL,'
            . '`id_order` INT UNSIGNED NOT NULL,'
            . '`record_id` VARCHAR(96) NOT NULL DEFAULT \'\','
            . '`idempotency_key` VARCHAR(255) NOT NULL DEFAULT \'\','
            . '`status` VARCHAR(64) NOT NULL DEFAULT \'new\','
            . '`last_error` TEXT NULL,'
            . '`date_upd` DATETIME NOT NULL,'
            . 'PRIMARY KEY (`id_pvf_order_sync`),'
            . 'UNIQUE KEY `pvf_shop_order` (`id_shop`, `id_order`)'
            . ') ENGINE=' . _MYSQL_ENGINE_ . ' DEFAULT CHARSET=utf8mb4;';
        return (bool) Db::getInstance()->execute($sql);
    }

    private function uninstallSchema()
    {
        return (bool) Db::getInstance()->execute('DROP TABLE IF EXISTS `' . _DB_PREFIX_ . 'pvf_order_sync`');
    }

    private function getSyncRow($orderId)
    {
        $shopId = (int) $this->context->shop->id;
        $row = Db::getInstance()->getRow(
            'SELECT * FROM `' . _DB_PREFIX_ . 'pvf_order_sync` WHERE `id_shop` = ' . $shopId . ' AND `id_order` = ' . (int) $orderId
        );
        return is_array($row) ? $row : null;
    }

    private function saveSync(Order $order, $recordId, $idempotencyKey, $status, $lastError)
    {
        $existing = $this->getSyncRow((int) $order->id);
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
            . (int) $order->id_shop . ','
            . (int) $order->id . ',\'' . pSQL((string) $recordId) . '\',\'' . pSQL((string) $idempotencyKey) . '\',\''
            . pSQL((string) $status) . '\',\'' . pSQL((string) $lastError, true) . '\',NOW()) '
            . 'ON DUPLICATE KEY UPDATE '
            . '`record_id`=VALUES(`record_id`),`idempotency_key`=VALUES(`idempotency_key`),'
            . '`status`=VALUES(`status`),`last_error`=VALUES(`last_error`),`date_upd`=NOW()'
        );
    }

    private function safeMessage(Exception $exception)
    {
        return Tools::safeOutput(substr((string) $exception->getMessage(), 0, 500));
    }
}
