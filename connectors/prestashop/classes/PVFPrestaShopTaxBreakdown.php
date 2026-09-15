<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

final class PVFPrestaShopTaxBreakdown
{
    public static function fromBreakdowns(array $productRows, array $shippingRows, array $wrappingRows)
    {
        $groups = array();

        self::appendRows($groups, $productRows, 'total_price_tax_excl', 'total_amount');
        self::appendRows($groups, $shippingRows, 'total_tax_excl', 'total_amount');
        self::appendRows($groups, $wrappingRows, 'total_tax_excl', 'total_amount');

        $lines = array();
        foreach ($groups as $values) {
            $lines[] = array(
                'rate' => $values['rate'],
                'baseAmount' => self::fromScaled($values['base']),
                'taxAmount' => self::fromScaled($values['tax']),
            );
        }

        usort($lines, array(__CLASS__, 'sortByRate'));

        return $lines;
    }

    public static function reconcile(array $lines, $expectedBase, $expectedTax)
    {
        $expectedBaseScaled = self::toScaled($expectedBase);
        $expectedTaxScaled = self::toScaled($expectedTax);
        $baseScaled = 0;
        $taxScaled = 0;

        foreach ($lines as $line) {
            $baseScaled += self::toScaled(isset($line['baseAmount']) ? $line['baseAmount'] : 0);
            $taxScaled += self::toScaled(isset($line['taxAmount']) ? $line['taxAmount'] : 0);
        }

        $taxDelta = $expectedTaxScaled - $taxScaled;
        if (abs($taxDelta) > 1) {
            throw new RuntimeException('PrestaShop tax breakdown does not reconcile with the invoice tax total.');
        }
        if ($taxDelta !== 0) {
            $index = self::largestBaseIndex($lines);
            if ($index === null) {
                throw new RuntimeException('PrestaShop tax total is non-zero but no tax line is available.');
            }
            $lines[$index]['taxAmount'] = self::fromScaled(self::toScaled($lines[$index]['taxAmount']) + $taxDelta);
            $taxScaled += $taxDelta;
        }

        $baseDelta = $expectedBaseScaled - $baseScaled;
        if ($baseDelta < -1) {
            throw new RuntimeException('PrestaShop tax breakdown base exceeds the invoice taxable base.');
        }

        if ($baseDelta > 1) {
            self::mergeScaledLine($lines, '0', $baseDelta, 0);
            $baseScaled += $baseDelta;
        } elseif ($baseDelta !== 0) {
            $index = self::largestBaseIndex($lines);
            if ($index === null) {
                self::mergeScaledLine($lines, '0', $baseDelta, 0);
            } else {
                $lines[$index]['baseAmount'] = self::fromScaled(self::toScaled($lines[$index]['baseAmount']) + $baseDelta);
            }
            $baseScaled += $baseDelta;
        }

        usort($lines, array(__CLASS__, 'sortByRate'));

        $finalBase = 0;
        $finalTax = 0;
        foreach ($lines as $line) {
            $finalBase += self::toScaled($line['baseAmount']);
            $finalTax += self::toScaled($line['taxAmount']);
        }

        if ($finalBase !== $expectedBaseScaled || $finalTax !== $expectedTaxScaled) {
            throw new RuntimeException('PrestaShop tax breakdown reconciliation failed.');
        }

        return $lines;
    }

    private static function appendRows(array &$groups, array $rows, $baseKey, $taxKey)
    {
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $rate = self::rate(isset($row['rate']) ? $row['rate'] : 0);
            $base = self::toScaled(isset($row[$baseKey]) ? $row[$baseKey] : 0);
            $tax = self::toScaled(isset($row[$taxKey]) ? $row[$taxKey] : 0);
            self::addScaled($groups, $rate, $base, $tax);
        }
    }

    private static function addScaled(array &$groups, $rate, $base, $tax)
    {
        $key = (string) $rate;
        if (!isset($groups[$key])) {
            $groups[$key] = array('rate' => $key, 'base' => 0, 'tax' => 0);
        }
        $groups[$key]['base'] += (int) $base;
        $groups[$key]['tax'] += (int) $tax;
    }

    private static function mergeScaledLine(array &$lines, $rate, $base, $tax)
    {
        $normalized = self::rate($rate);
        foreach ($lines as &$line) {
            if (self::rate(isset($line['rate']) ? $line['rate'] : 0) === $normalized) {
                $line['rate'] = $normalized;
                $line['baseAmount'] = self::fromScaled(self::toScaled($line['baseAmount']) + (int) $base);
                $line['taxAmount'] = self::fromScaled(self::toScaled($line['taxAmount']) + (int) $tax);
                unset($line);
                return;
            }
        }
        unset($line);

        $lines[] = array(
            'rate' => $normalized,
            'baseAmount' => self::fromScaled($base),
            'taxAmount' => self::fromScaled($tax),
        );
    }

    private static function largestBaseIndex(array $lines)
    {
        $index = null;
        $largest = -1;
        foreach ($lines as $key => $line) {
            $base = abs(self::toScaled(isset($line['baseAmount']) ? $line['baseAmount'] : 0));
            if ($base > $largest) {
                $largest = $base;
                $index = $key;
            }
        }
        return $index;
    }

    private static function sortByRate($left, $right)
    {
        $a = (float) (isset($left['rate']) ? $left['rate'] : 0);
        $b = (float) (isset($right['rate']) ? $right['rate'] : 0);
        if ($a === $b) {
            return 0;
        }
        return $a < $b ? -1 : 1;
    }

    public static function rate($value)
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
