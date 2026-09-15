<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

function upgrade_module_0_2_0($module)
{
    if (!$module->isRegisteredInHook('displayAdminOrderMainBottom')) {
        if (!$module->registerHook('displayAdminOrderMainBottom')) {
            return false;
        }
    }

    return true;
}
