<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

function upgrade_module_0_3_0($module)
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
