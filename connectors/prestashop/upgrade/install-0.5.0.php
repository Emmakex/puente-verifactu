<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

function upgrade_module_0_5_0($module)
{
    if (!$module instanceof Module) {
        return false;
    }

    require_once dirname(__DIR__) . '/classes/PVFPrestaShopInvoicePresentation.php';
    require_once dirname(__DIR__) . '/classes/PVFPrestaShopCompatibility.php';

    $table = _DB_PREFIX_ . 'pvf_order_sync';
    $column = Db::getInstance()->getRow(
        "SHOW COLUMNS FROM `" . bqSQL($table) . "` LIKE 'presentation_json'"
    );
    if (!is_array($column)) {
        if (!Db::getInstance()->execute(
            'ALTER TABLE `' . bqSQL($table) . '` ADD `presentation_json` MEDIUMTEXT NULL AFTER `status`'
        )) {
            return false;
        }
    }

    if (!PVFPrestaShopCompatibility::registerAvailableHooks($module, array(
        'displayAdminOrderMainBottom',
        'displayPDFInvoice',
        'actionOrderStatusPostUpdate',
        'actionOrderSlipAdd',
    ))) {
        return false;
    }

    return true;
}
