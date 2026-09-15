<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

final class PVFPrestaShopOrderPayload
{
    public static function build(Order $order, array $settings)
    {
        $shopId = (int) $settings['shop_id'];
        $currency = new Currency((int) $order->id_currency);
        $invoiceAddress = new Address((int) $order->id_address_invoice);
        $customer = new Customer((int) $order->id_customer);

        if (!Validate::isLoadedObject($currency)) {
            throw new RuntimeException('Order currency could not be loaded.');
        }
        if (!Validate::isLoadedObject($invoiceAddress)) {
            throw new RuntimeException('Invoice address could not be loaded.');
        }

        return array(
            'connector_schema' => 1,
            'source_invoice_id' => 'prestashop:' . $shopId . ':order:' . (int) $order->id,
            'order_id' => (string) (int) $order->id,
            'order_reference' => trim((string) $order->reference),
            'invoice_number' => self::invoiceNumber($order),
            'order_date' => self::invoiceDate($order),
            'description' => 'PrestaShop order ' . trim((string) $order->reference),
            'currency' => strtoupper(trim((string) $currency->iso_code)),
            'customer_name' => self::customerName($customer, $invoiceAddress),
            'customer_tax_id' => self::customerTaxId($invoiceAddress),
            'total_amount' => self::money($order->total_paid_tax_incl),
            'discount_amount' => self::money($order->total_discounts_tax_incl),
            'shipping_amount' => self::money($order->total_shipping_tax_excl),
            'tax_amount' => self::money(((float) $order->total_paid_tax_incl) - ((float) $order->total_paid_tax_excl)),
            'tax_lines' => self::taxLines($order),
        );
    }

    public static function invoiceNumber(Order $order)
    {
        $number = (int) $order->invoice_number;
        if ($number <= 0) {
            throw new RuntimeException('The order does not have a fiscal invoice number yet.');
        }

        if (class_exists('OrderInvoice') && method_exists('OrderInvoice', 'getInvoiceNumberFormatted')) {
            $formatted = OrderInvoice::getInvoiceNumberFormatted($number, (int) $order->id_lang);
            if (trim((string) $formatted) !== '') {
                return trim((string) $formatted);
            }
        }

        $prefix = (string) Configuration::get('PS_INVOICE_PREFIX', (int) $order->id_lang, null, (int) $order->id_shop);
        return trim($prefix . (string) $number);
    }

    public static function invoiceDate(Order $order)
    {
        $date = trim((string) $order->invoice_date);
        if ($date === '' || strpos($date, '0000-00-00') === 0) {
            throw new RuntimeException('The order does not have a fiscal invoice date yet.');
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

    public static function taxLines(Order $order)
    {
        $rows = Db::getInstance()->executeS(
            'SELECT `tax_rate`, `total_price_tax_excl`, `total_price_tax_incl` '
            . 'FROM `' . _DB_PREFIX_ . 'order_detail` WHERE `id_order` = ' . (int) $order->id
        );
        if (!is_array($rows) || empty($rows)) {
            throw new RuntimeException('The order does not contain fiscalizable order lines.');
        }

        $groups = array();
        foreach ($rows as $row) {
            $rate = self::rate(isset($row['tax_rate']) ? $row['tax_rate'] : 0);
            $base = self::toScaled(isset($row['total_price_tax_excl']) ? $row['total_price_tax_excl'] : 0);
            $incl = self::toScaled(isset($row['total_price_tax_incl']) ? $row['total_price_tax_incl'] : 0);
            self::addLine($groups, $rate, $base, $incl - $base);
        }

        $shippingBase = self::toScaled($order->total_shipping_tax_excl);
        $shippingIncl = self::toScaled($order->total_shipping_tax_incl);
        if ($shippingBase !== 0 || $shippingIncl !== 0) {
            $shippingTax = $shippingIncl - $shippingBase;
            self::addLine($groups, self::derivedRate($shippingBase, $shippingTax), $shippingBase, $shippingTax);
        }

        $wrappingBase = self::toScaled($order->total_wrapping_tax_excl);
        $wrappingIncl = self::toScaled($order->total_wrapping_tax_incl);
        if ($wrappingBase !== 0 || $wrappingIncl !== 0) {
            $wrappingTax = $wrappingIncl - $wrappingBase;
            self::addLine($groups, self::derivedRate($wrappingBase, $wrappingTax), $wrappingBase, $wrappingTax);
        }

        $result = array();
        foreach ($groups as $rate => $values) {
            $result[] = array(
                'rate' => (string) $rate,
                'baseAmount' => self::fromScaled($values['base']),
                'taxAmount' => self::fromScaled($values['tax']),
            );
        }
        return $result;
    }

    private static function addLine(array &$groups, $rate, $base, $tax)
    {
        $key = (string) $rate;
        if (!isset($groups[$key])) {
            $groups[$key] = array('base' => 0, 'tax' => 0);
        }
        $groups[$key]['base'] += (int) $base;
        $groups[$key]['tax'] += (int) $tax;
    }

    private static function derivedRate($base, $tax)
    {
        if ((int) $base === 0) {
            return '0';
        }
        return self::rate((((float) $tax) / ((float) $base)) * 100);
    }

    private static function rate($value)
    {
        $formatted = number_format((float) $value, 4, '.', '');
        $formatted = rtrim(rtrim($formatted, '0'), '.');
        return $formatted === '' ? '0' : $formatted;
    }

    public static function money($value)
    {
        return self::fromScaled(self::toScaled($value));
    }

    private static function toScaled($value)
    {
        return (int) round(((float) $value) * 100, 0, PHP_ROUND_HALF_UP);
    }

    private static function fromScaled($value)
    {
        $negative = ((int) $value) < 0;
        $absolute = abs((int) $value);
        return ($negative ? '-' : '') . intdiv($absolute, 100) . '.' . str_pad((string) ($absolute % 100), 2, '0', STR_PAD_LEFT);
    }
}
