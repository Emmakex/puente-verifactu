<?php

defined( 'ABSPATH' ) || exit;

final class PV_Woo_Client {
    private $endpoint;
    private $profile_id;
    private $token;
    private $timeout;

    public function __construct( array $settings ) {
        $this->endpoint   = untrailingslashit( (string) $settings['endpoint'] );
        $this->profile_id = (string) $settings['profile_id'];
        $this->token      = PV_Woo_Secret_Store::get();
        $this->timeout    = max( 5, min( 30, (int) $settings['request_timeout'] ) );
    }

    public function configured() {
        return 0 === strpos( $this->endpoint, 'https://' ) && '' !== $this->profile_id && '' !== $this->token;
    }

    public function preflight( array $source ) {
        return $this->request(
            'POST',
            '/v1/preflight',
            array(
                'profileId' => $this->profile_id,
                'source'    => $source,
            )
        );
    }

    public function issue( array $source, $idempotency_key ) {
        return $this->request(
            'POST',
            '/v1/fiscal-records',
            array(
                'profileId' => $this->profile_id,
                'source'    => $source,
            ),
            array( 'Idempotency-Key' => (string) $idempotency_key )
        );
    }

    public function status( $record_id ) {
        if ( ! preg_match( '/^fr_[a-f0-9]+$/', (string) $record_id ) ) {
            return new WP_Error( 'pv_invalid_record_id', __( 'The Puente record ID is invalid.', 'puente-verifactu-woocommerce' ) );
        }
        return $this->request( 'GET', '/v1/fiscal-records/' . rawurlencode( $record_id ) );
    }

    private function request( $method, $path, array $body = null, array $extra_headers = array() ) {
        if ( ! $this->configured() ) {
            return new WP_Error( 'pv_not_configured', __( 'Puente VeriFactu is not fully configured.', 'puente-verifactu-woocommerce' ), array( 'retryable' => false ) );
        }

        $url = $this->endpoint . $path;
        if ( 0 !== strpos( $url, 'https://' ) ) {
            return new WP_Error( 'pv_https_required', __( 'Puente VeriFactu requires an HTTPS endpoint.', 'puente-verifactu-woocommerce' ), array( 'retryable' => false ) );
        }

        $headers = array_merge(
            array(
                'Authorization'       => 'Bearer ' . $this->token,
                'Accept'              => 'application/json',
                'Content-Type'        => 'application/json',
                'X-Connector-Version' => 'woocommerce/' . PV_WOO_VERSION,
            ),
            $extra_headers
        );

        $args = array(
            'method'      => strtoupper( $method ),
            'timeout'     => $this->timeout,
            'redirection' => 0,
            'headers'     => $headers,
            'user-agent'  => 'PuenteVeriFactu-WooCommerce/' . PV_WOO_VERSION . '; ' . home_url( '/' ),
        );
        if ( null !== $body ) {
            $args['body'] = wp_json_encode( $body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
        }

        $response = wp_remote_request( $url, $args );
        if ( is_wp_error( $response ) ) {
            return new WP_Error(
                'pv_transport_error',
                __( 'Puente VeriFactu could not be reached.', 'puente-verifactu-woocommerce' ),
                array( 'cause' => $response->get_error_code(), 'retryable' => true )
            );
        }

        $status = (int) wp_remote_retrieve_response_code( $response );
        $raw    = (string) wp_remote_retrieve_body( $response );
        $json   = json_decode( $raw, true );
        if ( ! is_array( $json ) ) {
            return new WP_Error(
                'pv_invalid_response',
                __( 'Puente VeriFactu returned an invalid response.', 'puente-verifactu-woocommerce' ),
                array( 'http_status' => $status, 'retryable' => 429 === $status || $status >= 500 )
            );
        }

        if ( $status < 200 || $status >= 300 ) {
            $code    = isset( $json['error']['code'] ) ? sanitize_key( $json['error']['code'] ) : 'pv_api_error';
            $message = isset( $json['error']['message'] ) ? sanitize_text_field( $json['error']['message'] ) : __( 'Puente VeriFactu rejected the request.', 'puente-verifactu-woocommerce' );
            return new WP_Error( $code, $message, array( 'http_status' => $status, 'retryable' => ! empty( $json['error']['retryable'] ) || 429 === $status || $status >= 500 ) );
        }

        return $json;
    }
}
