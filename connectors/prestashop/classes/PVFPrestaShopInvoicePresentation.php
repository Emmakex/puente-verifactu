<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

final class PVFPrestaShopInvoicePresentation
{
    const SPEC_VERSION = '0.5.0';

    public static function encodeApiResult(array $result)
    {
        if (!isset($result['presentation']) || !is_array($result['presentation'])) {
            throw new RuntimeException('Puente VeriFactu did not return invoice presentation metadata.');
        }

        $presentation = self::normalize($result['presentation']);
        $json = json_encode($presentation, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            throw new RuntimeException('Puente VeriFactu presentation metadata could not be encoded.');
        }

        return $json;
    }

    public static function renderForInvoice(Module $module, array $params)
    {
        $invoice = isset($params['object']) ? $params['object'] : null;
        if (!$invoice instanceof OrderInvoice) {
            return '';
        }

        $orderId = (int) $invoice->id_order;
        if ($orderId <= 0) {
            return '';
        }

        $order = new Order($orderId);
        if (!Validate::isLoadedObject($order)) {
            return '';
        }

        $row = Db::getInstance()->getRow(
            'SELECT record_id,presentation_json FROM ' . _DB_PREFIX_ . 'pvf_order_sync'
            . ' WHERE id_shop = ' . (int) $order->id_shop
            . ' AND id_order = ' . (int) $order->id
        );

        if (!is_array($row) || trim((string) $row['record_id']) === '') {
            return '';
        }

        $raw = isset($row['presentation_json']) ? trim((string) $row['presentation_json']) : '';
        if ($raw === '') {
            throw new RuntimeException('Puente VeriFactu presentation metadata is missing for this fiscalized invoice.');
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Puente VeriFactu presentation metadata is invalid.');
        }

        $presentation = self::normalize($decoded);
        $png = self::qrPng((string) $presentation['qr']['url']);
        if ($png === '') {
            throw new RuntimeException('Puente VeriFactu could not render the invoice QR code.');
        }

        $prefix = Tools::safeOutput((string) $presentation['qr']['prefixText']);
        $verification = Tools::safeOutput((string) $presentation['verificationText']);
        $image = 'data:image/png;base64,' . base64_encode($png);

        return '<table style="width:100%; margin-top:4mm;"><tr><td style="width:45%;"></td>'
            . '<td style="width:55%; text-align:center; background-color:#ffffff;">'
            . '<div style="font-size:9pt; margin-bottom:1mm;"><strong>' . $prefix . '</strong></div>'
            . '<div style="background-color:#ffffff; padding:2mm;">'
            . '<img src="' . $image . '" style="width:32mm; height:32mm;" />'
            . '</div>'
            . '<div style="font-size:8pt; margin-top:1mm;">' . $verification . '</div>'
            . '</td></tr></table>';
    }

    public static function normalize(array $presentation)
    {
        if (!isset($presentation['mode']) || (string) $presentation['mode'] !== 'VERI*FACTU') {
            throw new RuntimeException('Puente VeriFactu presentation mode is invalid.');
        }
        if (!isset($presentation['specificationVersion']) || (string) $presentation['specificationVersion'] !== self::SPEC_VERSION) {
            throw new RuntimeException('Puente VeriFactu QR specification version is invalid.');
        }
        if (!isset($presentation['qr']) || !is_array($presentation['qr'])) {
            throw new RuntimeException('Puente VeriFactu QR metadata is missing.');
        }

        $qr = $presentation['qr'];
        $url = isset($qr['url']) ? trim((string) $qr['url']) : '';
        if (!self::isAllowedAeatQrUrl($url)) {
            throw new RuntimeException('Puente VeriFactu QR URL is invalid.');
        }
        if (!isset($qr['prefixText']) || (string) $qr['prefixText'] !== 'QR tributario:') {
            throw new RuntimeException('Puente VeriFactu QR prefix is invalid.');
        }
        if (!isset($qr['errorCorrection']) || (string) $qr['errorCorrection'] !== 'M') {
            throw new RuntimeException('Puente VeriFactu QR error correction is invalid.');
        }

        $verification = isset($presentation['verificationText']) ? trim((string) $presentation['verificationText']) : '';
        if ($verification !== 'Factura verificable en la sede electrónica de la AEAT') {
            throw new RuntimeException('Puente VeriFactu verification text is invalid.');
        }

        return array(
            'mode' => 'VERI*FACTU',
            'qr' => array(
                'url' => $url,
                'prefixText' => 'QR tributario:',
                'errorCorrection' => 'M',
                'minSizeMm' => isset($qr['minSizeMm']) ? (int) $qr['minSizeMm'] : 30,
                'maxSizeMm' => isset($qr['maxSizeMm']) ? (int) $qr['maxSizeMm'] : 40,
                'minQuietZoneMm' => isset($qr['minQuietZoneMm']) ? (int) $qr['minQuietZoneMm'] : 2,
                'recommendedQuietZoneMm' => isset($qr['recommendedQuietZoneMm']) ? (int) $qr['recommendedQuietZoneMm'] : 6,
            ),
            'verificationText' => $verification,
            'specificationVersion' => self::SPEC_VERSION,
        );
    }

    private static function isAllowedAeatQrUrl($url)
    {
        if ($url === '' || strpos($url, 'https://') !== 0) {
            return false;
        }

        $parts = parse_url($url);
        if (!is_array($parts)) {
            return false;
        }

        $host = isset($parts['host']) ? strtolower((string) $parts['host']) : '';
        $path = isset($parts['path']) ? (string) $parts['path'] : '';
        if (!in_array($host, array('prewww2.aeat.es', 'www2.agenciatributaria.gob.es'), true)) {
            return false;
        }
        if ($path !== '/wlpl/TIKE-CONT/ValidarQR') {
            return false;
        }

        parse_str(isset($parts['query']) ? (string) $parts['query'] : '', $query);
        foreach (array('nif', 'numserie', 'fecha', 'importe') as $key) {
            if (!isset($query[$key]) || trim((string) $query[$key]) === '') {
                return false;
            }
        }

        return true;
    }

    private static function qrPng($url)
    {
        if (!class_exists('TCPDF2DBarcode')) {
            $barcodeFile = defined('_PS_TOOL_DIR_') ? _PS_TOOL_DIR_ . 'tcpdf/tcpdf_barcodes_2d.php' : '';
            if ($barcodeFile === '' || !is_file($barcodeFile)) {
                return '';
            }
            require_once $barcodeFile;
        }

        if (!class_exists('TCPDF2DBarcode')) {
            return '';
        }

        $barcode = new TCPDF2DBarcode($url, 'QRCODE,M');
        $png = $barcode->getBarcodePngData(4, 4, array(0, 0, 0));
        return is_string($png) ? $png : '';
    }
}
