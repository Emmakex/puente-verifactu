<?php
declare(strict_types=1);

function requiredEnv(string $name): string
{
    $value = trim((string) getenv($name));
    if ($value === '') {
        throw new RuntimeException($name . ' is required');
    }
    return $value;
}

$baseUrl = rtrim(requiredEnv('PUENTE_BASE_URL'), '/');
$token = requiredEnv('PUENTE_TOKEN');

function apiRequest(
    string $path,
    string $method = 'GET',
    ?array $body = null,
    ?string $idempotencyKey = null
): array {
    global $baseUrl, $token;

    $headers = [
        'Accept: application/json',
        'Authorization: Bearer ' . $token,
    ];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
    }
    if ($idempotencyKey !== null && $idempotencyKey !== '') {
        $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
    }

    $ch = curl_init($baseUrl . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 30,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    }

    $raw = curl_exec($ch);
    if ($raw === false) {
        $message = curl_error($ch);
        curl_close($ch);
        throw new RuntimeException('Transport error: ' . $message);
    }
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    $payload = $raw === '' ? [] : json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if ($status < 200 || $status >= 300) {
        $error = $payload['error'] ?? [];
        throw new RuntimeException(
            ($error['code'] ?? 'HTTP_ERROR') . ': ' . ($error['message'] ?? ('HTTP ' . $status))
        );
    }
    return $payload;
}

function loadJson(string $path): array
{
    $raw = file_get_contents($path);
    if ($raw === false) {
        throw new RuntimeException('Cannot read JSON file');
    }
    return json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
}

function preflight(array $payload): array
{
    return apiRequest('/v1/preflight', 'POST', $payload);
}

function issue(array $payload, string $idempotencyKey): array
{
    return apiRequest('/v1/fiscal-records', 'POST', $payload, $idempotencyKey);
}

function status(string $recordId): array
{
    return apiRequest('/v1/fiscal-records/' . rawurlencode($recordId) . '/status');
}

function cancel(string $recordId, string $sourceCancellationId, string $idempotencyKey): array
{
    return apiRequest(
        '/v1/fiscal-records/' . rawurlencode($recordId) . '/cancel',
        'POST',
        ['sourceCancellationId' => $sourceCancellationId],
        $idempotencyKey
    );
}

try {
    $command = $argv[1] ?? '';
    if ($command === 'preflight') {
        $result = preflight(loadJson($argv[2] ?? ''));
    } elseif ($command === 'issue' || $command === 'rectify') {
        $result = issue(loadJson($argv[2] ?? ''), $argv[3] ?? '');
    } elseif ($command === 'status') {
        $result = status($argv[2] ?? '');
    } elseif ($command === 'cancel') {
        $result = cancel($argv[2] ?? '', $argv[3] ?? '', $argv[4] ?? '');
    } else {
        throw new RuntimeException(
            'Usage: preflight <json> | issue|rectify <json> <idempotency-key> | status <recordId> | cancel <recordId> <sourceCancellationId> <idempotency-key>'
        );
    }
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . PHP_EOL);
    exit(1);
}
