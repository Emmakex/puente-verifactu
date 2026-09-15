<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

require_once __DIR__ . '/PVFPrestaShopApiException.php';

final class PVFPrestaShopClient
{
    private $endpoint;
    private $profileId;
    private $token;
    private $timeout;
    private $moduleVersion;
    private $shopUrl;

    public function __construct(array $settings)
    {
        $this->endpoint = rtrim((string) $settings['endpoint'], '/');
        $this->profileId = trim((string) $settings['profile_id']);
        $this->token = trim((string) $settings['token']);
        $this->timeout = max(5, min(30, (int) $settings['request_timeout']));
        $this->moduleVersion = (string) $settings['module_version'];
        $this->shopUrl = (string) $settings['shop_url'];
    }

    public function configured()
    {
        return strpos($this->endpoint, 'https://') === 0 && $this->profileId !== '' && $this->token !== '';
    }

    public function preflight(array $source)
    {
        return $this->request('POST', '/v1/preflight', array(
            'profileId' => $this->profileId,
            'source' => $source,
        ));
    }

    public function issue(array $source, $idempotencyKey)
    {
        return $this->request('POST', '/v1/fiscal-records', array(
            'profileId' => $this->profileId,
            'source' => $source,
        ), array('Idempotency-Key: ' . (string) $idempotencyKey));
    }

    public function status($recordId)
    {
        $recordId = trim((string) $recordId);
        if (!preg_match('/^fr_[a-f0-9]+$/', $recordId)) {
            throw new PVFPrestaShopApiException(
                'The Puente VeriFactu record ID is invalid.',
                'PVF_INVALID_RECORD_ID',
                0,
                false
            );
        }
        return $this->request('GET', '/v1/fiscal-records/' . rawurlencode($recordId));
    }

    private function request($method, $path, array $body = null, array $extraHeaders = array())
    {
        if (!$this->configured()) {
            throw new PVFPrestaShopApiException(
                'Puente VeriFactu is not fully configured.',
                'PVF_NOT_CONFIGURED',
                0,
                false
            );
        }
        if (!function_exists('curl_init')) {
            throw new PVFPrestaShopApiException(
                'The cURL PHP extension is required.',
                'PVF_CURL_UNAVAILABLE',
                0,
                false
            );
        }

        $url = $this->endpoint . $path;
        if (strpos($url, 'https://') !== 0) {
            throw new PVFPrestaShopApiException(
                'Puente VeriFactu requires an HTTPS endpoint.',
                'PVF_HTTPS_REQUIRED',
                0,
                false
            );
        }

        $headers = array_merge(array(
            'Authorization: Bearer ' . $this->token,
            'Accept: application/json',
            'Content-Type: application/json',
            'X-Connector-Version: prestashop/' . $this->moduleVersion,
        ), $extraHeaders);

        $curl = curl_init($url);
        if ($curl === false) {
            throw new PVFPrestaShopApiException(
                'Could not initialize the Puente VeriFactu request.',
                'PVF_CURL_INIT_FAILED',
                0,
                true
            );
        }

        $options = array(
            CURLOPT_CUSTOMREQUEST => strtoupper((string) $method),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => min(10, $this->timeout),
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT => 'PuenteVeriFactu-PrestaShop/' . $this->moduleVersion . '; ' . $this->shopUrl,
        );
        if ($body !== null) {
            $json = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($json === false) {
                curl_close($curl);
                throw new PVFPrestaShopApiException(
                    'Could not encode the Puente VeriFactu request.',
                    'PVF_JSON_ENCODE_FAILED',
                    0,
                    false
                );
            }
            $options[CURLOPT_POSTFIELDS] = $json;
        }
        curl_setopt_array($curl, $options);

        $raw = curl_exec($curl);
        $curlError = curl_error($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);

        if ($raw === false) {
            throw new PVFPrestaShopApiException(
                'Puente VeriFactu could not be reached: ' . $curlError,
                'PVF_TRANSPORT_ERROR',
                0,
                true
            );
        }

        $decoded = json_decode((string) $raw, true);
        if (!is_array($decoded)) {
            throw new PVFPrestaShopApiException(
                'Puente VeriFactu returned an invalid JSON response.',
                'PVF_INVALID_RESPONSE',
                $status,
                $status === 429 || $status >= 500
            );
        }
        if ($status < 200 || $status >= 300) {
            $error = isset($decoded['error']) && is_array($decoded['error']) ? $decoded['error'] : array();
            $message = isset($error['message']) ? (string) $error['message'] : 'Puente VeriFactu rejected the request.';
            $code = isset($error['code']) ? (string) $error['code'] : 'PVF_API_ERROR';
            $retryable = !empty($error['retryable']) || $status === 429 || $status >= 500;
            $correlationId = isset($error['correlationId']) ? (string) $error['correlationId'] : '';
            throw new PVFPrestaShopApiException(
                $message . ' [HTTP ' . $status . ']',
                $code,
                $status,
                $retryable,
                $correlationId
            );
        }

        return $decoded;
    }
}
