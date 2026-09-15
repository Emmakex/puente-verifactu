<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

final class PVFPrestaShopApiException extends RuntimeException
{
    private $retryable;
    private $httpStatus;
    private $apiCode;
    private $correlationId;

    public function __construct($message, $apiCode = 'PVF_API_ERROR', $httpStatus = 0, $retryable = false, $correlationId = '', Exception $previous = null)
    {
        parent::__construct((string) $message, 0, $previous);
        $this->apiCode = (string) $apiCode;
        $this->httpStatus = (int) $httpStatus;
        $this->retryable = (bool) $retryable;
        $this->correlationId = (string) $correlationId;
    }

    public function isRetryable()
    {
        return $this->retryable;
    }

    public function getHttpStatus()
    {
        return $this->httpStatus;
    }

    public function getApiCode()
    {
        return $this->apiCode;
    }

    public function getCorrelationId()
    {
        return $this->correlationId;
    }
}
