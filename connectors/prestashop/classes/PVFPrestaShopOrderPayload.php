<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

require_once __DIR__ . '/PVFPrestaShopTaxBreakdown.php';

final class PVFPrestaShopOrderPayload
{
    public static function build(Order $order, array $settings)
    {
        $shopId = (int) $settings['shop_id'];
        $currency = new Currency((int) $order->id_currency);
        $invoiceAddress = new Address((int) $order->id_address_invoice);
        $customer = new Customer((int) $order->id_customer);
        $invoice = self::invoiceForOrder($order);

        if (!Validate::isLoadedObject($currency)) {
            throw new RuntimeException('Order currency could not be loaded.');
        }
        if (!Validate::isLoadedObject($invoiceAddress)) {
            throw new RuntimeException('Invoice address could not be loaded.');
        }

        $taxContext = self::taxContext($order, $invoice);

        return array(
            'connector_schema' => 1,
            'source_invoice_id' => 'prestashop:' . $shopId . ':invoice:' . (int) $invoice->id,
            'order_id' => (string) (int) $order->id,
            'order_reference' => trim((string) $order->reference),
            'invoice_id' => (string) (int) $invoice->id,
            'invoice_number' => self::invoiceNumber($order, $invoice),
            'order_date' => self::invoiceDate($invoice),
            'description' => 'PrestaShop invoice ' . (int) $invoice->number . ' / order ' . trim((string) $order->reference),
            'currency' => strtoupper(trim((string) $currency->iso_code)),
            'customer_name' => self::customerName($customer, $invoiceAddress),
            'customer_tax_id' => self::customerTaxId($invoiceAddress),
            'total_amount' => PVFPrestaShopTaxBreakdown::money($invoice->total_paid_tax_incl),
            'discount_amount' => PVFPrestaShopTaxBreakdown::money($invoice->total_discount_tax_incl),
            'shipping_amount' => self::sumBase($taxContext['shipping']),
            'wrapping_amount' => self::sumBase($taxContext['wrapping']),
            'tax_amount' => PVFPrestaShopTaxBreakdown::money(((float) $invoice->total_paid_tax_incl) - ((float) $invoice->total_paid_tax_excl)),
            'tax_lines' => $taxContext['lines'],
        );
    }

    public static function invoiceForOrder(Order $order)
    {
        $invoices = array();
        foreach ($order->getInvoicesCollection() as $invoice) {
            if ($invoice instanceof OrderInvoice && (int) $invoice->number > 0) {
                $invoices[] = $invoice;
            }
        }

        if (count($invoices) === 0) {
            throw new RuntimeException('The order does not have a fiscal invoice yet.');
        }
        if (count($invoices) > 1) {
            throw new RuntimeException('The order has multiple invoices. Selective split-invoice fiscalization is not enabled yet.');
        }

        return $invoices[0];
    }

    public static function invoiceNumber(Order $order, OrderInvoice $invoice)
    {
        $formatted = $invoice->getInvoiceNumberFormatted((int) $order->id_lang, (int) $order->id_shop);
        if (trim((string) $formatted) !== '') {
            return trim((string) $formatted);
        }

        $prefix = (string) Configuration::get('PS_INVOICE_PREFIX', (int) $order->id_lang, null, (int) $order->id_shop);
        return trim($prefix . (string) (int) $invoice->number);
    }

    public static function invoiceDate(OrderInvoice $invoice)
    {
        $date = trim((string) $invoice->date_add);
        if ($date === '' || strpos($date, '0000-00-00') === 0) {
            throw new RuntimeException('The invoice does not have a fiscal creation date yet.');
        }
        return substr($date, 0, 10);
    }

    public static function customerName(Customer $customer, Address $invoiceAddress)
    {
        $company = trim((string) $invoiceAddress->company);
        if ($company !== '') {
            return $company;
        }
        $name = trim((string) $invoiceAddress->firstname . ' ' . (string) $invoiceAddress->lastname);
        if ($name === '' && Validate::isLoadedObject($customer)) {
            $name = trim((string) $customer->firstname . ' ' . (string) $customer->lastname);
        }
        return $name === '' ? 'PrestaShop customer' : $name;
    }

    public static function customerTaxId(Address $invoiceAddress)
    {
        $vat = trim((string) $invoiceAddress->vat_number);
        if ($vat !== '') {
            return strtoupper($vat);
        }
        return strtoupper(trim((string) $invoiceAddress->dni));
    }

    public static function taxLines(Order $order, OrderInvoice $invoice)
    {
        $context = self::taxContext($order, $invoice);
        return $context['lines'];
    }

    private static function taxContext(Order $order, OrderInvoice $invoice)
    {
        $ecotaxRows = $invoice->getEcoTaxTaxesBreakdown();
        foreach ($ecotaxRows as $row) {
            $base = isset($row['ecotax_tax_excl']) ? (float) $row['ecotax_tax_excl'] : 0.0;
            $incl = isset($row['ecotax_tax_incl']) ? (float) $row['ecotax_tax_incl'] : 0.0;
            if (abs($base) > 0.00001 || abs($incl - $base) > 0.00001) {
                throw new RuntimeException('Ecotax requires an explicit fiscal mapping and is blocked by this connector version.');
            }
        }

        $products = $invoice->getProductTaxesBreakdown($order);
        $shipping = $invoice->getShippingTaxesBreakdown($order);
        $wrapping = $invoice->getWrappingTaxesBreakdown();

        $lines = PVFPrestaShopTaxBreakdown::fromBreakdowns($products, $shipping, $wrapping);
        $expectedBase = $invoice->total_paid_tax_excl;
        $expectedTax = ((float) $invoice->total_paid_tax_incl) - ((float) $invoice->total_paid_tax_excl);
        $lines = PVFPrestaShopTaxBreakdown::reconcile($lines, $expectedBase, $expectedTax);

        return array(
            'products' => $products,
            'shipping' => $shipping,
            'wrapping' => $wrapping,
            'lines' => $lines,
        );
    }

    private static function sumBase(array $rows)
    {
        $total = 0.0;
        foreach ($rows as $row) {
            $total += isset($row['total_tax_excl']) ? (float) $row['total_tax_excl'] : 0.0;
        }
        return PVFPrestaShopTaxBreakdown::money($total);
    }
}
