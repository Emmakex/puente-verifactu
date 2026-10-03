<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * Capability-first compatibility layer.
 *
 * Runtime behavior is selected from available platform capabilities, never
 * from hard-coded PrestaShop version branches. Tested versions remain a CI
 * concern, separate from runtime compatibility.
 */
final class PVFPrestaShopCompatibility
{
    public static function hookAvailable($hookName)
    {
        return class_exists('Hook')
            && method_exists('Hook', 'getIdByName')
            && (int) Hook::getIdByName((string) $hookName) > 0;
    }

    public static function registerAvailableHooks(Module $module, array $hookNames)
    {
        foreach ($hookNames as $hookName) {
            if (!self::hookAvailable($hookName)) {
                continue;
            }
            if (method_exists($module, 'isRegisteredInHook') && $module->isRegisteredInHook($hookName)) {
                continue;
            }
            if (!$module->registerHook($hookName)) {
                return false;
            }
        }
        return true;
    }

    public static function invoicePresentationCapabilities()
    {
        $pdfHook = self::hookAvailable('displayPDFInvoice');
        $renderer = class_exists('PVFPrestaShopInvoicePresentation')
            && method_exists('PVFPrestaShopInvoicePresentation', 'rendererAvailable')
            && PVFPrestaShopInvoicePresentation::rendererAvailable();

        return array(
            'pdf_hook' => $pdfHook,
            'qr_renderer' => $renderer,
            'ready' => $pdfHook && $renderer,
        );
    }

    public static function assertInvoicePresentationReady()
    {
        $capabilities = self::invoicePresentationCapabilities();
        if (empty($capabilities['ready'])) {
            throw new RuntimeException(
                'This PrestaShop runtime cannot render the required VERI*FACTU invoice presentation. '
                . 'The connector remains installable, but fiscal emission is blocked until a compatible PDF hook and QR renderer are available.'
            );
        }
    }
}
