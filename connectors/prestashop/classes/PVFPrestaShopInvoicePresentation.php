<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

final class PVFPrestaShopInvoicePresentation
{
    const SPEC_VERSION = '0.5.0';

    public static function rendererAvailable()
    {
        if (class_exists('TCPDF2DBarcode')) {
            return true;
        }

        foreach (self::barcodeCandidates() as $path) {
            if ($path !== '' && is_file($path)) {
                return true;
            }
        }

        return false;
    }

    public static function getForOrder($shopId, $orderId)
    {
        $row = Db::getInstance()->getRow(
            'SELECT record_id,presentation_json FROM ' . _DB_PREFIX_ . 'pvf_order_sync'
            . ' WHERE id_shop = ' . (int) $shopId
            . ' AND id_order = ' . (int) $orderId
        );
        return self::decodeStoredRow($row, 'invoice');
    }

    public static function getForOrderSlip($shopId, $slipId)
    {
        $row = Db::getInstance()->getRow(
            'SELECT record_id,presentation_json FROM ' . _DB_PREFIX_ . 'pvf_order_slip_sync'
            . ' WHERE id_shop = ' . (int) $shopId
            . ' AND id_order_slip = ' . (int) $slipId
        );
        return self::decodeStoredRow($row, 'corrective invoice');
    }

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

        $presentation = self::getForOrder((int) $order->id_shop, (int) $order->id);
        if ($presentation === null) {
            return '';
        }

        return self::renderPresentation($presentation);
    }

    public static function renderForOrderSlip(Module $module, array $params)
    {
        $slip = isset($params['object']) ? $params['object'] : null;
        if (!$slip instanceof OrderSlip) {
            return '';
        }

        $order = new Order((int) $slip->id_order);
        if (!Validate::isLoadedObject($order)) {
            return '';
        }

        $presentation = self::getForOrderSlip((int) $order->id_shop, (int) $slip->id);
        if ($presentation === null) {
            return '';
        }

        return self::renderPresentation($presentation);
    }

    private static function renderPresentation(array $presentation)
    {
        $png = self::qrPng((string) $presentation['qr']['url']);
        if ($png === '') {
            throw new RuntimeException('Puente VeriFactu could not render the invoice QR code.');
        }

        // Both literals are accepted only after exact allowlist validation in normalize().
        // Keep UTF-8 intact so TCPDF receives the official wording without HTML entity drift.
        $prefix = (string) $presentation['qr']['prefixText'];
        $verification = (string) $presentation['verificationText'];
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
        if ((int) (isset($qr['minSizeMm']) ? $qr['minSizeMm'] : 0) !== 30
            || (int) (isset($qr['maxSizeMm']) ? $qr['maxSizeMm'] : 0) !== 40
            || (int) (isset($qr['minQuietZoneMm']) ? $qr['minQuietZoneMm'] : 0) < 2) {
            throw new RuntimeException('Puente VeriFactu QR physical presentation contract is invalid.');
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

        $allowed = array('nif', 'numserie', 'fecha', 'importe', 'idioma');
        foreach (array_keys($query) as $key) {
            if (!in_array((string) $key, $allowed, true)) {
                return false;
            }
        }
        if (isset($query['idioma'])
            && !in_array(strtolower((string) $query['idioma']), array('gl', 'ca', 'eu', 'es', 'va', 'en'), true)) {
            return false;
        }

        return true;
    }

    private static function decodeStoredRow($row, $kind)
    {
        if (!is_array($row) || trim((string) $row['record_id']) === '') {
            return null;
        }

        $raw = isset($row['presentation_json']) ? trim((string) $row['presentation_json']) : '';
        if ($raw === '') {
            throw new RuntimeException('Puente VeriFactu presentation metadata is missing for this fiscalized ' . $kind . '.');
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Puente VeriFactu presentation metadata is invalid for this ' . $kind . '.');
        }

        return self::normalize($decoded);
    }

    private static function barcodeCandidates()
    {
        return array(
            defined('_PS_ROOT_DIR_') ? _PS_ROOT_DIR_ . '/vendor/tecnickcom/tcpdf/tcpdf_barcodes_2d.php' : '',
            defined('_PS_TOOL_DIR_') ? _PS_TOOL_DIR_ . 'tcpdf/tcpdf_barcodes_2d.php' : '',
            defined('_PS_ROOT_DIR_') ? _PS_ROOT_DIR_ . '/tools/tcpdf/tcpdf_barcodes_2d.php' : '',
        );
    }

    private static function qrPng($url)
    {
        if (!class_exists('TCPDF2DBarcode')) {
            foreach (self::barcodeCandidates() as $barcodeFile) {
                if ($barcodeFile !== '' && is_file($barcodeFile)) {
                    require_once $barcodeFile;
                    if (class_exists('TCPDF2DBarcode')) {
                        break;
                    }
                }
            }
        }

        if (!class_exists('TCPDF2DBarcode')) {
            return '';
        }

        $barcode = new TCPDF2DBarcode($url, 'QRCODE,M');
        $png = $barcode->getBarcodePngData(4, 4, array(0, 0, 0));
        return is_string($png) ? $png : '';
    }
}
