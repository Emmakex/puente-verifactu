<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * Capability-first compatibility layer.
 *
 * Runtime behavior is selected from platform capabilities, not from hard-coded
 * PrestaShop version branches. CI remains the source of truth for versions
 * actually exercised end-to-end.
 */
final class PVFPrestaShopCompatibility
{
    public static function hookAvailable($hookName)
    {
        $hookName = (string) $hookName;

        if (class_exists('Hook')
            && method_exists('Hook', 'getIdByName')
            && (int) Hook::getIdByName($hookName) > 0) {
            return true;
        }

        // displayPDF<Template> hooks are dynamic in PrestaShop. They may not
        // exist in the hook table until a module registers them, even though
        // the corresponding PDF template capability is present in core.
        $dynamicPdfTemplates = array(
            'displayPDFInvoice' => 'HTMLTemplateInvoice',
            'displayPDFOrderSlip' => 'HTMLTemplateOrderSlip',
        );

        return isset($dynamicPdfTemplates[$hookName])
            && class_exists($dynamicPdfTemplates[$hookName]);
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

    public static function presentationCapabilities()
    {
        $renderer = class_exists('PVFPrestaShopInvoicePresentation')
            && method_exists('PVFPrestaShopInvoicePresentation', 'rendererAvailable')
            && PVFPrestaShopInvoicePresentation::rendererAvailable();

        return array(
            'invoice_pdf_hook' => self::hookAvailable('displayPDFInvoice'),
            'order_slip_pdf_hook' => self::hookAvailable('displayPDFOrderSlip'),
            'qr_renderer' => $renderer,
        );
    }

    public static function invoicePresentationReady()
    {
        $capabilities = self::presentationCapabilities();
        return !empty($capabilities['invoice_pdf_hook']) && !empty($capabilities['qr_renderer']);
    }

    public static function correctivePresentationReady()
    {
        $capabilities = self::presentationCapabilities();
        return !empty($capabilities['order_slip_pdf_hook']) && !empty($capabilities['qr_renderer']);
    }

    public static function assertInvoicePresentationReady()
    {
        if (!self::invoicePresentationReady()) {
            throw new RuntimeException(
                'This PrestaShop runtime cannot render the required VERI*FACTU invoice presentation. '
                . 'Fiscal emission is blocked until a compatible invoice PDF hook and QR renderer are available.'
            );
        }
    }

    public static function assertCorrectivePresentationReady()
    {
        if (!self::correctivePresentationReady()) {
            throw new RuntimeException(
                'This PrestaShop runtime cannot render the required VERI*FACTU corrective-invoice presentation. '
                . 'Corrective fiscal emission is blocked until a compatible credit-slip PDF hook and QR renderer are available.'
            );
        }
    }
}
