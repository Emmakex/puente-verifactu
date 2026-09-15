<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

function upgrade_module_0_4_0($module)
{
    if (!$module instanceof Module) {
        return false;
    }

    require_once dirname(__DIR__) . '/classes/PVFPrestaShopAutomation.php';

    if (!$module->registerHook('actionOrderStatusPostUpdate')) {
        return false;
    }
    if (!$module->registerHook('actionOrderSlipAdd')) {
        return false;
    }

    $shopIds = Shop::getShops(false, null, true);
    if (!is_array($shopIds) || count($shopIds) === 0) {
        $shopIds = array((int) Context::getContext()->shop->id);
    }

    foreach ($shopIds as $shopId) {
        if (!PVFPrestaShopAutomation::installDefaults((int) $shopId)) {
            return false;
        }
    }

    return true;
}
