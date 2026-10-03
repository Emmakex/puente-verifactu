<?php

defined( 'ABSPATH' ) || exit;

final class PV_Woo_Invoice_Presentation {
    const META_KEY = '_pv_presentation_v1';
    const SPEC_VERSION = '0.5.0';

    public static function extract( array $result ) {
        if ( empty( $result['presentation'] ) || ! is_array( $result['presentation'] ) ) {
            return null;
        }

        $presentation = $result['presentation'];
        $qr = isset( $presentation['qr'] ) && is_array( $presentation['qr'] ) ? $presentation['qr'] : array();
        $url = isset( $qr['url'] ) ? esc_url_raw( (string) $qr['url'] ) : '';
        $host = strtolower( (string) wp_parse_url( $url, PHP_URL_HOST ) );

        if ( 'VERI*FACTU' !== (string) ( $presentation['mode'] ?? '' )
            || self::SPEC_VERSION !== (string) ( $presentation['specificationVersion'] ?? '' )
            || 'QR tributario:' !== (string) ( $qr['prefixText'] ?? '' )
            || 'M' !== (string) ( $qr['errorCorrection'] ?? '' )
            || 'Factura verificable en la sede electrónica de la AEAT' !== (string) ( $presentation['verificationText'] ?? '' )
            || ! in_array( $host, array( 'prewww2.aeat.es', 'www2.agenciatributaria.gob.es' ), true ) ) {
            return new WP_Error(
                'pv_presentation_invalid',
                __( 'Puente VeriFactu returned invalid invoice presentation metadata.', 'puente-verifactu-woocommerce' ),
                array( 'retryable' => false )
            );
        }

        return array(
            'mode'                  => 'VERI*FACTU',
            'qr_url'                => $url,
            'prefix_text'           => 'QR tributario:',
            'verification_text'     => 'Factura verificable en la sede electrónica de la AEAT',
            'error_correction'      => 'M',
            'min_size_mm'           => isset( $qr['minSizeMm'] ) ? (int) $qr['minSizeMm'] : 30,
            'max_size_mm'           => isset( $qr['maxSizeMm'] ) ? (int) $qr['maxSizeMm'] : 40,
            'specification_version' => self::SPEC_VERSION,
        );
    }

    public static function store( WC_Abstract_Order $order, array $result ) {
        $presentation = self::extract( $result );
        if ( is_wp_error( $presentation ) ) {
            return $presentation;
        }
        if ( null === $presentation ) {
            return new WP_Error(
                'pv_presentation_missing',
                __( 'Puente VeriFactu did not return invoice presentation metadata.', 'puente-verifactu-woocommerce' ),
                array( 'retryable' => false )
            );
        }

        $order->update_meta_data( self::META_KEY, wp_json_encode( $presentation, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
        return $presentation;
    }

    public static function get( $order ) {
        if ( is_numeric( $order ) ) {
            $order = wc_get_order( (int) $order );
        }
        if ( ! ( $order instanceof WC_Abstract_Order ) ) {
            return null;
        }

        $raw = $order->get_meta( self::META_KEY, true );
        if ( ! is_string( $raw ) || '' === $raw ) {
            return null;
        }
        $decoded = json_decode( $raw, true );
        if ( ! is_array( $decoded )
            || 'VERI*FACTU' !== (string) ( $decoded['mode'] ?? '' )
            || self::SPEC_VERSION !== (string) ( $decoded['specification_version'] ?? '' )
            || empty( $decoded['qr_url'] ) ) {
            return null;
        }

        return $decoded;
    }

    public static function filter( $presentation, $order ) {
        $stored = self::get( $order );
        return null !== $stored ? $stored : $presentation;
    }
}

if ( ! function_exists( 'pv_woo_get_invoice_presentation' ) ) {
    function pv_woo_get_invoice_presentation( $order ) {
        return PV_Woo_Invoice_Presentation::get( $order );
    }
}
