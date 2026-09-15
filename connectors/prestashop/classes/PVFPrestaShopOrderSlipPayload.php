<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

require_once __DIR__ . '/PVFPrestaShopTaxBreakdown.php';
require_once __DIR__ . '/PVFPrestaShopOrderPayload.php';

final class PVFPrestaShopOrderSlipPayload
{
    const TAX_TOLERANCE_CENTS = 2;

    public static function build(OrderSlip $slip, Order $order, array $settings)
    {
        if (!Validate::isLoadedObject($slip) || !Validate::isLoadedObject($order)) {
            throw new RuntimeException('PrestaShop credit slip or parent order could not be loaded.');
        }
        if ((int) $slip->id_order !== (int) $order->id) {
            throw new RuntimeException('The PrestaShop credit slip does not belong to the selected order.');
        }

        $shopId = (int) $settings['shop_id'];
        if ((int) $order->id_shop !== $shopId) {
            throw new RuntimeException('The credit slip does not belong to the current shop context.');
        }

        $currency = new Currency((int) $order->id_currency);
        $invoiceAddress = new Address((int) $order->id_address_invoice);
        $customer = new Customer((int) $order->id_customer);
        $invoice = PVFPrestaShopOrderPayload::invoiceForOrder($order);

        if (!Validate::isLoadedObject($currency)) {
            throw new RuntimeException('Order currency could not be loaded for the credit slip.');
        }
        if (!Validate::isLoadedObject($invoiceAddress)) {
            throw new RuntimeException('Invoice address could not be loaded for the credit slip.');
        }

        $totalBase = ((float) $slip->total_products_tax_excl) + ((float) $slip->total_shipping_tax_excl);
        $totalIncl = ((float) $slip->total_products_tax_incl) + ((float) $slip->total_shipping_tax_incl);
        $totalTax = $totalIncl - $totalBase;

        if ($totalIncl <= 0.0 || $totalBase < 0.0 || $totalTax < -0.01) {
            throw new RuntimeException('The PrestaShop credit slip totals are not valid for a corrective payload.');
        }

        return array(
            'connector_schema' => 1,
            'source_invoice_id' => 'prestashop:' . $shopId . ':order-slip:' . (int) $slip->id,
            'refund_id' => (string) (int) $slip->id,
            'order_slip_id' => (string) (int) $slip->id,
            'parent_order_id' => (string) (int) $order->id,
            'refund_invoice_number' => self::creditSlipNumber($order, $slip),
            'refund_date' => self::creditSlipDate($slip),
            'description' => 'PrestaShop credit slip ' . (int) $slip->id . ' / order ' . trim((string) $order->reference),
            'currency' => strtoupper(trim((string) $currency->iso_code)),
            'customer_name' => PVFPrestaShopOrderPayload::customerName($customer, $invoiceAddress),
            'customer_tax_id' => PVFPrestaShopOrderPayload::customerTaxId($invoiceAddress),
            'original_invoice_number' => PVFPrestaShopOrderPayload::invoiceNumber($order, $invoice),
            'original_invoice_date' => PVFPrestaShopOrderPayload::invoiceDate($invoice),
            'total_amount' => self::negativeMoney($totalIncl),
            'tax_amount' => self::negativeMoney($totalTax),
            'tax_lines' => self::taxLines($slip, $order),
            'source_metadata' => array(
                'order_slip_type' => (string) (int) $slip->order_slip_type,
                'partial' => (bool) $slip->partial,
            ),
        );
    }

    public static function creditSlipNumber(Order $order, OrderSlip $slip)
    {
        $prefix = (string) Configuration::get(
            'PS_CREDIT_SLIP_PREFIX',
            (int) $order->id_lang,
            null,
            (int) $order->id_shop
        );

        return trim($prefix . sprintf('%06d', (int) $slip->id));
    }

    public static function creditSlipDate(OrderSlip $slip)
    {
        $date = trim((string) $slip->date_add);
        if ($date === '' || strpos($date, '0000-00-00') === 0) {
            throw new RuntimeException('The PrestaShop credit slip does not have a valid creation date.');
        }
        return substr($date, 0, 10);
    }

    public static function taxLines(OrderSlip $slip, Order $order)
    {
        $productRows = array();
        $detailBaseCents = 0;
        $detailTaxCents = 0;

        foreach (OrderSlip::getOrdersSlipDetail((int) $slip->id) as $detail) {
            if (!is_array($detail)) {
                continue;
            }

            $orderDetailId = isset($detail['id_order_detail']) ? (int) $detail['id_order_detail'] : 0;
            $orderDetail = new OrderDetail($orderDetailId);
            if ($orderDetailId <= 0 || !Validate::isLoadedObject($orderDetail) || (int) $orderDetail->id_order !== (int) $order->id) {
                throw new RuntimeException('A PrestaShop credit-slip line cannot be linked safely to its original order detail.');
            }

            $base = isset($detail['amount_tax_excl']) ? (float) $detail['amount_tax_excl'] : 0.0;
            $incl = isset($detail['amount_tax_incl']) ? (float) $detail['amount_tax_incl'] : 0.0;
            $tax = $incl - $base;
            if (abs($base) < 0.00001 && abs($tax) < 0.00001) {
                continue;
            }
            if ($base < 0.0 || $tax < -0.01) {
                throw new RuntimeException('A PrestaShop credit-slip product line contains invalid refund amounts.');
            }

            $baseCents = self::cents($base);
            $taxCents = self::cents($tax);
            if ($baseCents === 0 && $taxCents !== 0) {
                throw new RuntimeException('A PrestaShop credit-slip tax amount cannot be attributed to a taxable base.');
            }

            $rate = self::orderDetailRate($orderDetail);
            self::assertObservedTaxMatchesRate($baseCents, $taxCents, $rate, 'product');

            $detailBaseCents += $baseCents;
            $detailTaxCents += $taxCents;
            $productRows[] = array(
                'rate' => $rate,
                'total_price_tax_excl' => $base,
                'total_amount' => $tax,
            );
        }

        $shippingRows = array();
        $shippingBase = (float) $slip->total_shipping_tax_excl;
        $shippingIncl = (float) $slip->total_shipping_tax_incl;
        $shippingTax = $shippingIncl - $shippingBase;
        $shippingBaseCents = self::cents($shippingBase);
        $shippingTaxCents = self::cents($shippingTax);
        if ($shippingBaseCents !== 0 || $shippingTaxCents !== 0) {
            if ($shippingBaseCents < 0 || $shippingTaxCents < -1) {
                throw new RuntimeException('The PrestaShop credit-slip shipping amounts are invalid.');
            }
            if ($shippingBaseCents === 0 && $shippingTaxCents !== 0) {
                throw new RuntimeException('The PrestaShop credit-slip shipping tax cannot be attributed to a taxable base.');
            }

            $shippingRate = self::shippingRate($order);
            self::assertObservedTaxMatchesRate($shippingBaseCents, $shippingTaxCents, $shippingRate, 'shipping');
            $shippingRows[] = array(
                'rate' => $shippingRate,
                'total_tax_excl' => $shippingBase,
                'total_amount' => $shippingTax,
            );
        }

        $expectedBaseCents = self::cents(((float) $slip->total_products_tax_excl) + $shippingBase);
        $expectedTaxCents = self::cents(
            (((float) $slip->total_products_tax_incl) - ((float) $slip->total_products_tax_excl)) + $shippingTax
        );
        $extractedBaseCents = $detailBaseCents + $shippingBaseCents;
        $extractedTaxCents = $detailTaxCents + $shippingTaxCents;

        if (abs($expectedBaseCents - $extractedBaseCents) > 1 || abs($expectedTaxCents - $extractedTaxCents) > 1) {
            throw new RuntimeException('PrestaShop credit-slip lines do not reconcile with the credit-slip totals. Fiscal tax attribution is ambiguous.');
        }

        $positive = PVFPrestaShopTaxBreakdown::fromBreakdowns($productRows, $shippingRows, array());
        $positive = PVFPrestaShopTaxBreakdown::reconcile(
            $positive,
            ((float) $slip->total_products_tax_excl) + $shippingBase,
            (((float) $slip->total_products_tax_incl) - ((float) $slip->total_products_tax_excl)) + $shippingTax
        );

        $negative = array();
        foreach ($positive as $line) {
            $negative[] = array(
                'rate' => (string) $line['rate'],
                'baseAmount' => self::negativeMoney($line['baseAmount']),
                'taxAmount' => self::negativeMoney($line['taxAmount']),
            );
        }

        if (count($negative) === 0) {
            throw new RuntimeException('The PrestaShop credit slip has no attributable fiscal lines.');
        }

        return $negative;
    }

    public static function observedTaxMatchesRate($baseCents, $taxCents, $rate, $toleranceCents = self::TAX_TOLERANCE_CENTS)
    {
        $baseCents = (int) $baseCents;
        $taxCents = (int) $taxCents;
        $toleranceCents = max(0, (int) $toleranceCents);
        $expected = (int) round(((float) $baseCents) * ((float) $rate) / 100.0, 0, PHP_ROUND_HALF_UP);
        return abs($expected - $taxCents) <= $toleranceCents;
    }

    private static function orderDetailRate(OrderDetail $orderDetail)
    {
        $calculator = $orderDetail->getTaxCalculator();
        if (!($calculator instanceof TaxCalculator) || !method_exists($calculator, 'getTotalRate')) {
            throw new RuntimeException('The historical PrestaShop product tax rate could not be loaded.');
        }
        return PVFPrestaShopTaxBreakdown::rate($calculator->getTotalRate());
    }

    private static function shippingRate(Order $order)
    {
        $carrier = new Carrier((int) $order->id_carrier);
        $address = Address::initialize((int) $order->id_address_delivery, false);
        if (!Validate::isLoadedObject($carrier) || !Validate::isLoadedObject($address)) {
            throw new RuntimeException('The PrestaShop shipping tax context could not be loaded.');
        }

        $calculator = $carrier->getTaxCalculator($address);
        if (!($calculator instanceof TaxCalculator) || !method_exists($calculator, 'getTotalRate')) {
            throw new RuntimeException('The PrestaShop shipping tax rate could not be loaded.');
        }
        return PVFPrestaShopTaxBreakdown::rate($calculator->getTotalRate());
    }

    private static function assertObservedTaxMatchesRate($baseCents, $taxCents, $rate, $scope)
    {
        if (!self::observedTaxMatchesRate($baseCents, $taxCents, $rate)) {
            throw new RuntimeException(
                'The PrestaShop credit-slip ' . (string) $scope
                . ' tax does not match its native historical tax rate. Fiscal attribution is blocked.'
            );
        }
    }

    private static function negativeMoney($value)
    {
        $money = PVFPrestaShopTaxBreakdown::money($value);
        if (self::cents($money) === 0) {
            return '0.00';
        }
        return '-' . ltrim($money, '-');
    }

    private static function cents($value)
    {
        $money = PVFPrestaShopTaxBreakdown::money($value);
        $negative = strpos($money, '-') === 0;
        $parts = explode('.', ltrim($money, '-'), 2);
        $cents = ((int) $parts[0] * 100) + (int) (isset($parts[1]) ? str_pad($parts[1], 2, '0') : '00');
        return $negative ? -$cents : $cents;
    }
}
