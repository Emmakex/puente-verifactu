<?php

define('_PS_VERSION_', 'fixture');

require_once __DIR__ . '/../../connectors/prestashop/classes/PVFPrestaShopTaxBreakdown.php';

$fixturePath = __DIR__ . '/../../connectors/prestashop/fixtures/tax-breakdown-v1.json';
$raw = file_get_contents($fixturePath);
$data = json_decode((string) $raw, true);

if (!is_array($data) || !isset($data['cases']) || !is_array($data['cases'])) {
    fwrite(STDERR, json_encode(array('status' => 'failed', 'code' => 'PRESTA_FIXTURE_FILE_INVALID'), JSON_PRETTY_PRINT) . PHP_EOL);
    exit(1);
}

$failures = array();
$executed = 0;

foreach ($data['cases'] as $case) {
    ++$executed;
    $id = isset($case['id']) ? (string) $case['id'] : 'unknown';
    try {
        $lines = PVFPrestaShopTaxBreakdown::fromBreakdowns(
            isset($case['products']) && is_array($case['products']) ? $case['products'] : array(),
            isset($case['shipping']) && is_array($case['shipping']) ? $case['shipping'] : array(),
            isset($case['wrapping']) && is_array($case['wrapping']) ? $case['wrapping'] : array()
        );
        $lines = PVFPrestaShopTaxBreakdown::reconcile(
            $lines,
            isset($case['expectedBase']) ? $case['expectedBase'] : 0,
            isset($case['expectedTax']) ? $case['expectedTax'] : 0
        );
        $expected = isset($case['expectedLines']) && is_array($case['expectedLines']) ? $case['expectedLines'] : array();
        if ($lines !== $expected) {
            $failures[] = array(
                'case' => $id,
                'code' => 'PRESTA_FIXTURE_MISMATCH',
                'expected' => $expected,
                'received' => $lines,
            );
        }
    } catch (Exception $exception) {
        $failures[] = array(
            'case' => $id,
            'code' => 'PRESTA_FIXTURE_EXCEPTION',
            'message' => $exception->getMessage(),
        );
    }
}

if ($failures) {
    fwrite(STDERR, json_encode(array(
        'schema_version' => 1,
        'pipeline' => 'GitHub Actions',
        'job' => 'validation',
        'step' => 'prestashop-tax-fixtures',
        'exit_code' => 1,
        'primary_error' => $failures[0]['code'],
        'failures' => $failures,
        'root_cause_status' => 'confirmed',
    ), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
    exit(1);
}

fwrite(STDOUT, json_encode(array(
    'schema_version' => 1,
    'status' => 'ok',
    'check' => 'prestashop-tax-breakdown-v1',
    'fixture_cases' => $executed,
), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
