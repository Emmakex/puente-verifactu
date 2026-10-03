<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

function upgrade_module_0_5_0($module)
{
    if (!$module instanceof Module) {
        return false;
    }

    $table = _DB_PREFIX_ . 'pvf_order_sync';
    $column = Db::getInstance()->getRow(
        "SHOW COLUMNS FROM `" . bqSQL($table) . "` LIKE 'presentation_json'"
    );

    if (!is_array($column)) {
        $sql = 'ALTER TABLE `' . bqSQL($table) . '` ADD `presentation_json` TEXT NULL AFTER `status`';
        if (!Db::getInstance()->execute($sql)) {
            return false;
        }
    }

    if (!$module->isRegisteredInHook('displayPDFInvoice')
        && !$module->registerHook('displayPDFInvoice')) {
        return false;
    }

    return true;
}
