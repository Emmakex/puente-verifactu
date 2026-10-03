<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

function upgrade_module_0_5_0($module)
{
    if (!$module instanceof Module) {
        return false;
    }

    foreach (array('pvf_order_sync', 'pvf_order_slip_sync') as $suffix) {
        $table = _DB_PREFIX_ . $suffix;
        $columnCount = (int) Db::getInstance()->getValue(
            "SELECT COUNT(*) FROM information_schema.columns"
            . " WHERE table_schema = DATABASE()"
            . " AND table_name = '" . pSQL($table) . "'"
            . " AND column_name = 'presentation_json'"
        );

        if ($columnCount !== 1) {
            $sql = 'ALTER TABLE `' . bqSQL($table) . '` ADD `presentation_json` TEXT NULL AFTER `status`';
            if (!Db::getInstance()->execute($sql)) {
                return false;
            }
        }
    }

    foreach (array('displayPDFInvoice', 'displayPDFOrderSlip') as $hook) {
        if (!$module->isRegisteredInHook($hook) && !$module->registerHook($hook)) {
            return false;
        }
    }

    return true;
}
