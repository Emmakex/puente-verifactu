<?php

define('_PS_VERSION_', 'ci-fixture');

require_once __DIR__ . '/../../connectors/prestashop/classes/PVFPrestaShopTaxBreakdown.php';
require_once __DIR__ . '/../../connectors/prestashop/classes/PVFPrestaShopOrderPayload.php';
require_once __DIR__ . '/../../connectors/prestashop/classes/PVFPrestaShopOrderSlipPayload.php';

$cases = array(
    array('id' => 'vat-21-exact', 'base' => 10000, 'tax' => 2100, 'rate' => '21', 'expected' => true),
    array('id' => 'vat-10-exact', 'base' => 10000, 'tax' => 1000, 'rate' => '10', 'expected' => true),
    array('id' => 'vat-4-exact', 'base' => 10000, 'tax' => 400, 'rate' => '4', 'expected' => true),
    array('id' => 'vat-21-rounded-cent', 'base' => 333, 'tax' => 70, 'rate' => '21', 'expected' => true),
    array('id' => 'vat-21-two-cent-tolerance', 'base' => 10000, 'tax' => 2102, 'rate' => '21', 'expected' => true),
    array('id' => 'vat-21-reject-inferred-20-99', 'base' => 10000, 'tax' => 2099, 'rate' => '20.99', 'expected' => false, 'tolerance' => 0),
    array('id' => 'vat-21-material-mismatch', 'base' => 10000, 'tax' => 2050, 'rate' => '21', 'expected' => false),
    array('id' => 'zero-rate', 'base' => 10000, 'tax' => 0, 'rate' => '0', 'expected' => true),
);

$failures = array();
foreach ($cases as $case) {
    $tolerance = isset($case['tolerance']) ? (int) $case['tolerance'] : PVFPrestaShopOrderSlipPayload::TAX_TOLERANCE_CENTS;
    $actual = PVFPrestaShopOrderSlipPayload::observedTaxMatchesRate(
        (int) $case['base'],
        (int) $case['tax'],
        (string) $case['rate'],
        $tolerance
    );
    if ($actual !== $case['expected']) {
        $failures[] = array(
            'id' => $case['id'],
            'expected' => $case['expected'],
            'actual' => $actual,
        );
    }
}

if (count($failures) > 0) {
    fwrite(STDERR, json_encode(array(
        'schema_version' => 1,
        'status' => 'failed',
        'check' => 'prestashop-corrective-tax-fixtures',
        'failures' => $failures,
    ), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit(1);
}

fwrite(STDOUT, json_encode(array(
    'schema_version' => 1,
    'status' => 'ok',
    'check' => 'prestashop-corrective-tax-fixtures',
    'cases' => count($cases),
    'positive_vat_rates' => array('21', '10', '4'),
    'rounding_tolerance_cents' => PVFPrestaShopOrderSlipPayload::TAX_TOLERANCE_CENTS,
), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
