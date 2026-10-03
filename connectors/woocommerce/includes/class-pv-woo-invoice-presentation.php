<?php

defined( 'ABSPATH' ) || exit;

final class PV_Woo_Invoice_Presentation {
    const META_KEY     = '_pv_presentation_json';
    const SPEC_VERSION = '0.5.0';

    public static function from_api_result( array $result ) {
        if ( empty( $result['presentation'] ) || ! is_array( $result['presentation'] ) ) {
            return new WP_Error(
                'pv_presentation_missing',
                __( 'Puente VeriFactu did not return invoice presentation metadata.', 'puente-verifactu-woocommerce' ),
                array( 'retryable' => false )
            );
        }

        return self::normalize( $result['presentation'] );
    }

    public static function encode( array $presentation ) {
        $normalized = self::normalize( $presentation );
        if ( is_wp_error( $normalized ) ) {
            return $normalized;
        }

        $json = wp_json_encode( $normalized, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
        if ( ! is_string( $json ) || '' === $json ) {
            return new WP_Error(
                'pv_presentation_encode_failed',
                __( 'Puente VeriFactu presentation metadata could not be encoded.', 'puente-verifactu-woocommerce' ),
                array( 'retryable' => false )
            );
        }

        return $json;
    }

    public static function get( $order_or_id ) {
        $order = $order_or_id instanceof WC_Abstract_Order ? $order_or_id : wc_get_order( $order_or_id );
        if ( ! ( $order instanceof WC_Abstract_Order ) ) {
            return new WP_Error(
                'pv_presentation_order_invalid',
                __( 'The WooCommerce order could not be loaded.', 'puente-verifactu-woocommerce' ),
                array( 'retryable' => false )
            );
        }

        $record_id = trim( (string) $order->get_meta( PV_Woo_Connector::META_RECORD_ID, true ) );
        $raw       = trim( (string) $order->get_meta( self::META_KEY, true ) );

        if ( '' === $record_id && '' === $raw ) {
            return null;
        }
        if ( '' === $raw ) {
            return new WP_Error(
                'pv_presentation_missing',
                __( 'The fiscal record exists but its VERI*FACTU presentation metadata is missing.', 'puente-verifactu-woocommerce' ),
                array( 'retryable' => false, 'record_id' => $record_id )
            );
        }

        $decoded = json_decode( $raw, true );
        if ( ! is_array( $decoded ) ) {
            return new WP_Error(
                'pv_presentation_invalid_json',
                __( 'Stored VERI*FACTU presentation metadata is invalid.', 'puente-verifactu-woocommerce' ),
                array( 'retryable' => false, 'record_id' => $record_id )
            );
        }

        return self::normalize( $decoded );
    }

    public static function normalize( array $presentation ) {
        if ( empty( $presentation['mode'] ) || 'VERI*FACTU' !== (string) $presentation['mode'] ) {
            return self::invalid( 'mode' );
        }
        if ( empty( $presentation['specificationVersion'] ) || self::SPEC_VERSION !== (string) $presentation['specificationVersion'] ) {
            return self::invalid( 'specificationVersion' );
        }
        if ( empty( $presentation['qr'] ) || ! is_array( $presentation['qr'] ) ) {
            return self::invalid( 'qr' );
        }

        $qr  = $presentation['qr'];
        $url = isset( $qr['url'] ) ? trim( (string) $qr['url'] ) : '';
        if ( ! self::is_allowed_qr_url( $url ) ) {
            return self::invalid( 'qr.url' );
        }
        if ( ! isset( $qr['prefixText'] ) || 'QR tributario:' !== (string) $qr['prefixText'] ) {
            return self::invalid( 'qr.prefixText' );
        }
        if ( ! isset( $qr['errorCorrection'] ) || 'M' !== (string) $qr['errorCorrection'] ) {
            return self::invalid( 'qr.errorCorrection' );
        }
        if ( 30 !== (int) ( isset( $qr['minSizeMm'] ) ? $qr['minSizeMm'] : 0 )
            || 40 !== (int) ( isset( $qr['maxSizeMm'] ) ? $qr['maxSizeMm'] : 0 )
            || 2 > (int) ( isset( $qr['minQuietZoneMm'] ) ? $qr['minQuietZoneMm'] : 0 ) ) {
            return self::invalid( 'qr.physicalPresentation' );
        }

        $verification = isset( $presentation['verificationText'] )
            ? trim( (string) $presentation['verificationText'] )
            : '';
        if ( 'Factura verificable en la sede electrónica de la AEAT' !== $verification ) {
            return self::invalid( 'verificationText' );
        }

        $structured = isset( $presentation['structuredInvoice'] ) && is_array( $presentation['structuredInvoice'] )
            ? $presentation['structuredInvoice']
            : array();
        if ( empty( $structured['verificationUrlFieldRequired'] ) ) {
            return self::invalid( 'structuredInvoice.verificationUrlFieldRequired' );
        }

        return array(
            'mode' => 'VERI*FACTU',
            'qr'   => array(
                'url'                    => $url,
                'prefixText'             => 'QR tributario:',
                'errorCorrection'         => 'M',
                'minSizeMm'              => 30,
                'maxSizeMm'              => 40,
                'minQuietZoneMm'         => (int) $qr['minQuietZoneMm'],
                'recommendedQuietZoneMm' => isset( $qr['recommendedQuietZoneMm'] ) ? (int) $qr['recommendedQuietZoneMm'] : 6,
                'placement'              => isset( $qr['placement'] ) ? sanitize_key( (string) $qr['placement'] ) : 'first-page-preeminent',
            ),
            'verificationText' => $verification,
            'structuredInvoice' => array(
                'verificationUrlFieldRequired' => true,
            ),
            'specificationVersion' => self::SPEC_VERSION,
        );
    }

    public static function integration_contract( $order_or_id ) {
        $presentation = self::get( $order_or_id );
        if ( null === $presentation || is_wp_error( $presentation ) ) {
            return $presentation;
        }

        return array(
            'schema_version' => 1,
            'status'         => 'ready',
            'presentation'   => $presentation,
            'rendering'      => array(
                'qr_payload'       => $presentation['qr']['url'],
                'error_correction' => 'M',
                'recommended_size_mm' => 32,
                'quiet_zone_mm'    => max( 2, (int) $presentation['qr']['recommendedQuietZoneMm'] ),
                'prefix_text'      => 'QR tributario:',
                'verification_text'=> 'Factura verificable en la sede electrónica de la AEAT',
            ),
        );
    }

    private static function invalid( $field ) {
        return new WP_Error(
            'pv_presentation_invalid',
            sprintf(
                /* translators: %s: invalid presentation field */
                __( 'Invalid VERI*FACTU presentation field: %s', 'puente-verifactu-woocommerce' ),
                sanitize_text_field( (string) $field )
            ),
            array( 'retryable' => false, 'field' => (string) $field )
        );
    }

    private static function is_allowed_qr_url( $url ) {
        if ( '' === $url || 0 !== strpos( $url, 'https://' ) ) {
            return false;
        }

        $parts = wp_parse_url( $url );
        if ( ! is_array( $parts ) ) {
            return false;
        }

        $host = isset( $parts['host'] ) ? strtolower( (string) $parts['host'] ) : '';
        $path = isset( $parts['path'] ) ? (string) $parts['path'] : '';
        if ( ! in_array( $host, array( 'prewww2.aeat.es', 'www2.agenciatributaria.gob.es' ), true ) ) {
            return false;
        }
        if ( '/wlpl/TIKE-CONT/ValidarQR' !== $path ) {
            return false;
        }

        $query = array();
        parse_str( isset( $parts['query'] ) ? (string) $parts['query'] : '', $query );
        foreach ( array( 'nif', 'numserie', 'fecha', 'importe' ) as $key ) {
            if ( ! isset( $query[ $key ] ) || '' === trim( (string) $query[ $key ] ) ) {
                return false;
            }
        }

        $allowed = array( 'nif', 'numserie', 'fecha', 'importe', 'idioma' );
        foreach ( array_keys( $query ) as $key ) {
            if ( ! in_array( (string) $key, $allowed, true ) ) {
                return false;
            }
        }
        if ( isset( $query['idioma'] )
            && ! in_array( strtolower( (string) $query['idioma'] ), array( 'gl', 'ca', 'eu', 'es', 'va', 'en' ), true ) ) {
            return false;
        }

        return true;
    }
}

if ( ! function_exists( 'pv_woo_get_verifactu_presentation' ) ) {
    function pv_woo_get_verifactu_presentation( $order_or_id ) {
        return PV_Woo_Invoice_Presentation::integration_contract( $order_or_id );
    }
}
