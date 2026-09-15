<?php

defined( 'ABSPATH' ) || exit;

final class PV_Woo_Secret_Store {
    const OPTION = 'pv_woo_api_token';

    private static function key() {
        return hash( 'sha256', wp_salt( 'auth' ) . '|' . wp_salt( 'secure_auth' ), true );
    }

    public static function save( $secret ) {
        $secret = (string) $secret;
        if ( '' === $secret ) {
            delete_option( self::OPTION );
            return true;
        }

        $key = self::key();

        if ( function_exists( 'sodium_crypto_secretbox' ) ) {
            $nonce  = random_bytes( SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
            $cipher = sodium_crypto_secretbox( $secret, $nonce, $key );
            return update_option( self::OPTION, 'sodium:' . base64_encode( $nonce . $cipher ), false );
        }

        if ( function_exists( 'openssl_encrypt' ) ) {
            $iv  = random_bytes( 12 );
            $tag = '';
            $cipher = openssl_encrypt( $secret, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag );
            if ( false === $cipher ) {
                return false;
            }
            return update_option( self::OPTION, 'openssl:' . base64_encode( $iv . $tag . $cipher ), false );
        }

        return false;
    }

    public static function get() {
        $stored = (string) get_option( self::OPTION, '' );
        if ( '' === $stored ) {
            return '';
        }

        try {
            if ( 0 === strpos( $stored, 'sodium:' ) && function_exists( 'sodium_crypto_secretbox_open' ) ) {
                $raw = base64_decode( substr( $stored, 7 ), true );
                if ( false === $raw || strlen( $raw ) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ) {
                    return '';
                }
                $nonce  = substr( $raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
                $cipher = substr( $raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
                $plain  = sodium_crypto_secretbox_open( $cipher, $nonce, self::key() );
                return false === $plain ? '' : $plain;
            }

            if ( 0 === strpos( $stored, 'openssl:' ) && function_exists( 'openssl_decrypt' ) ) {
                $raw = base64_decode( substr( $stored, 8 ), true );
                if ( false === $raw || strlen( $raw ) <= 28 ) {
                    return '';
                }
                $iv     = substr( $raw, 0, 12 );
                $tag    = substr( $raw, 12, 16 );
                $cipher = substr( $raw, 28 );
                $plain  = openssl_decrypt( $cipher, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag );
                return false === $plain ? '' : $plain;
            }
        } catch ( Throwable $error ) {
            return '';
        }

        return '';
    }
}
