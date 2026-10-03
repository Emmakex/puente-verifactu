<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

final class PVFPrestaShopInvoicePresentation
{
    const SPEC_VERSION = '0.5.0';
    const PREFIX_TEXT = 'QR tributario:';
    const VERIFICATION_TEXT = 'Factura verificable en la sede electrónica de la AEAT';

    public static function extract(array $result)
    {
        if (!isset($result['presentation']) || !is_array($result['presentation'])) {
            return null;
        }

        $presentation = $result['presentation'];
        $qr = isset($presentation['qr']) && is_array($presentation['qr']) ? $presentation['qr'] : array();
        $url = isset($qr['url']) ? trim((string) $qr['url']) : '';
        $parts = $url !== '' ? parse_url($url) : false;
        $host = is_array($parts) && isset($parts['host']) ? strtolower((string) $parts['host']) : '';

        if ((string) (isset($presentation['mode']) ? $presentation['mode'] : '') !== 'VERI*FACTU'
            || (string) (isset($presentation['specificationVersion']) ? $presentation['specificationVersion'] : '') !== self::SPEC_VERSION
            || (string) (isset($qr['prefixText']) ? $qr['prefixText'] : '') !== self::PREFIX_TEXT
            || (string) (isset($qr['errorCorrection']) ? $qr['errorCorrection'] : '') !== 'M'
            || (string) (isset($presentation['verificationText']) ? $presentation['verificationText'] : '') !== self::VERIFICATION_TEXT
            || !is_array($parts)
            || strtolower((string) (isset($parts['scheme']) ? $parts['scheme'] : '')) !== 'https'
            || !in_array($host, array('prewww2.aeat.es', 'www2.agenciatributaria.gob.es'), true)) {
            throw new RuntimeException('Puente VeriFactu returned invalid invoice presentation metadata.');
        }

        return array(
            'mode' => 'VERI*FACTU',
            'qr_url' => $url,
            'prefix_text' => self::PREFIX_TEXT,
            'verification_text' => self::VERIFICATION_TEXT,
            'error_correction' => 'M',
            'specification_version' => self::SPEC_VERSION,
        );
    }

    public static function encode(array $result)
    {
        $presentation = self::extract($result);
        if ($presentation === null) {
            return '';
        }
        $json = json_encode($presentation, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            throw new RuntimeException('Could not encode VeriFactu invoice presentation metadata.');
        }
        return $json;
    }

    public static function decode($json)
    {
        $decoded = json_decode((string) $json, true);
        if (!is_array($decoded)
            || (string) (isset($decoded['mode']) ? $decoded['mode'] : '') !== 'VERI*FACTU'
            || (string) (isset($decoded['specification_version']) ? $decoded['specification_version'] : '') !== self::SPEC_VERSION
            || (string) (isset($decoded['error_correction']) ? $decoded['error_correction'] : '') !== 'M'
            || empty($decoded['qr_url'])) {
            return null;
        }
        return $decoded;
    }

    public static function rendererAvailable()
    {
        if (class_exists('TCPDF2DBarcode', false)) {
            return true;
        }

        foreach (self::tcpdfCandidates() as $path) {
            if ($path !== '' && is_file($path)) {
                return true;
            }
        }

        return false;
    }

    public static function renderPdfHtml(array $presentation)
    {
        $url = (string) $presentation['qr_url'];
        self::loadTcpdfBarcode();
        $barcode = new TCPDF2DBarcode($url, 'QRCODE,M');
        $array = $barcode->getBarcodeArray();
        if (!is_array($array) || empty($array['bcode']) || empty($array['num_rows']) || empty($array['num_cols'])) {
            throw new RuntimeException('Could not generate VeriFactu QR matrix.');
        }

        $quiet = 4;
        $rows = (int) $array['num_rows'];
        $cols = (int) $array['num_cols'];
        $totalRows = $rows + ($quiet * 2);
        $totalCols = $cols + ($quiet * 2);
        $cellMm = 38 / max($totalRows, $totalCols);

        $html = '<div style="font-size:9pt;">'
            . '<p style="margin:0 0 2mm 0;"><strong>' . Tools::safeOutput((string) $presentation['prefix_text']) . '</strong></p>'
            . '<table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background-color:#ffffff;">';

        for ($row = 0; $row < $totalRows; $row++) {
            $html .= '<tr>';
            for ($col = 0; $col < $totalCols; $col++) {
                $matrixRow = $row - $quiet;
                $matrixCol = $col - $quiet;
                $black = $matrixRow >= 0 && $matrixRow < $rows
                    && $matrixCol >= 0 && $matrixCol < $cols
                    && !empty($array['bcode'][$matrixRow][$matrixCol]);
                $html .= '<td style="width:' . sprintf('%.4F', $cellMm) . 'mm;height:' . sprintf('%.4F', $cellMm)
                    . 'mm;line-height:0;font-size:0;background-color:' . ($black ? '#000000' : '#ffffff') . ';">&nbsp;</td>';
            }
            $html .= '</tr>';
        }

        return $html
            . '</table>'
            . '<p style="margin:2mm 0 0 0;"><strong>VERI*FACTU</strong><br>'
            . Tools::safeOutput((string) $presentation['verification_text']) . '</p>'
            . '</div>';
    }

    private static function loadTcpdfBarcode()
    {
        if (class_exists('TCPDF2DBarcode', false)) {
            return;
        }

        foreach (self::tcpdfCandidates() as $path) {
            if ($path !== '' && is_file($path)) {
                require_once $path;
                if (class_exists('TCPDF2DBarcode', false)) {
                    return;
                }
            }
        }

        throw new RuntimeException('PrestaShop QR renderer is unavailable.');
    }

    private static function tcpdfCandidates()
    {
        return array(
            defined('_PS_ROOT_DIR_') ? _PS_ROOT_DIR_ . '/vendor/tecnickcom/tcpdf/tcpdf_barcodes_2d.php' : '',
            defined('_PS_TOOL_DIR_') ? _PS_TOOL_DIR_ . 'tcpdf/tcpdf_barcodes_2d.php' : '',
            defined('_PS_TOOL_DIR_') ? _PS_TOOL_DIR_ . 'tcpdf/2dbarcodes.php' : '',
        );
    }
}
