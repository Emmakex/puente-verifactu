<?php

defined( 'ABSPATH' ) || exit;

final class PV_Woo_Customer_Activation {
    const PREFIX = 'KFS2.';
    const ENDPOINT = 'https://kairoseth.com/api/fiscal';

    public static function register() {
        add_action( 'admin_post_pv_woo_connect', array( __CLASS__, 'maybe_exchange' ), 5 );
        add_action( 'admin_notices', array( __CLASS__, 'environment_notice' ) );
    }

    private static function ui( $english, $spanish ) {
        $locale = function_exists( 'determine_locale' ) ? determine_locale() : get_locale();
        if ( 0 === strpos( (string) $locale, 'es' ) ) {
            return $spanish;
        }
        return __( $english, 'puente-verifactu-woocommerce' );
    }

    private static function redirect() {
        wp_safe_redirect( admin_url( 'admin.php?page=puente-verifactu' ) );
        exit;
    }

    private static function fail( $message, $code = 'activation' ) {
        add_settings_error( 'pv_woo', $code, $message, 'error' );
        set_transient( 'settings_errors', get_settings_errors(), 30 );
        self::redirect();
    }

    public static function maybe_exchange() {
        $key = isset( $_POST['connection_key'] ) ? trim( (string) wp_unslash( $_POST['connection_key'] ) ) : '';
        if ( 0 !== strpos( $key, self::PREFIX ) ) {
            return;
        }

        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html( self::ui( 'You are not allowed to connect this store.', 'No tienes permisos para conectar esta tienda.' ) ) );
        }
        check_admin_referer( 'pv_woo_connect' );

        if ( strlen( $key ) > 256 || ! preg_match( '/^KFS2\.[A-Za-z0-9_-]{40,128}$/', $key ) ) {
            self::fail( self::ui( 'The connection key is not valid.', 'La clave de conexión no es válida.' ), 'activation_key' );
        }

        $response = wp_remote_post(
            self::ENDPOINT . '/v1/customer-activation/exchange',
            array(
                'timeout'     => 20,
                'redirection' => 0,
                'headers'     => array(
                    'Accept'       => 'application/json',
                    'Content-Type' => 'application/json',
                ),
                'body'        => wp_json_encode(
                    array(
                        'connectionKey' => $key,
                        'siteUrl'       => home_url( '/' ),
                        'connector'     => 'woocommerce',
                    )
                ),
            )
        );

        if ( is_wp_error( $response ) ) {
            self::fail( self::ui( 'VeriFactu Software could not be reached. Check connectivity and try again.', 'No se pudo conectar con VeriFactu Software. Comprueba la conexión e inténtalo de nuevo.' ), 'activation_http' );
        }

        $status = (int) wp_remote_retrieve_response_code( $response );
        $body = json_decode( wp_remote_retrieve_body( $response ), true );
        if ( $status < 200 || $status >= 300 || ! is_array( $body ) ) {
            $message = is_array( $body ) && ! empty( $body['error']['message'] )
                ? sanitize_text_field( (string) $body['error']['message'] )
                : self::ui( 'The activation could not be completed.', 'No se pudo completar la activación.' );
            self::fail( $message, 'activation_exchange' );
        }

        $profile_id = sanitize_key( (string) ( $body['profileId'] ?? '' ) );
        $token = trim( (string) ( $body['credential']['token'] ?? '' ) );
        $environment = sanitize_key( (string) ( $body['environment'] ?? 'test' ) );
        $endpoint = esc_url_raw( (string) ( $body['endpoint'] ?? self::ENDPOINT ) );

        if ( ! preg_match( '/^int_[a-f0-9]{32}$/', $profile_id ) || strlen( $token ) < 32 || strlen( $token ) > 2048 || preg_match( '/[\r\n]/', $token ) ) {
            self::fail( self::ui( 'VeriFactu Software returned an invalid scoped credential.', 'VeriFactu Software devolvió una credencial limitada no válida.' ), 'activation_credential' );
        }
        if ( 0 !== strpos( $endpoint, 'https://' ) ) {
            self::fail( self::ui( 'VeriFactu Software returned an invalid endpoint.', 'VeriFactu Software devolvió un endpoint no válido.' ), 'activation_endpoint' );
        }
        if ( ! PV_Woo_Secret_Store::save( $token ) ) {
            self::fail( self::ui( 'The connection credential could not be stored securely on this server.', 'La credencial de conexión no pudo guardarse de forma segura en este servidor.' ), 'activation_store' );
        }

        $settings = PV_Woo_Settings::get();
        $settings['endpoint'] = untrailingslashit( $endpoint );
        $settings['profile_id'] = $profile_id;
        $settings['refund_profile_id'] = '';
        $settings['environment'] = in_array( $environment, array( 'test', 'production' ), true ) ? $environment : 'test';
        update_option( PV_Woo_Settings::OPTION, $settings, false );

        add_settings_error(
            'pv_woo',
            'connected_kfs2',
            self::ui(
                'Store connected with a one-time activation. Environment: AEAT TEST. Run Preflight before enabling automatic sending.',
                'Tienda conectada mediante activación de un solo uso. Entorno: AEAT TEST. Ejecuta Preflight antes de activar el envío automático.'
            ),
            'updated'
        );
        set_transient( 'settings_errors', get_settings_errors(), 30 );
        self::redirect();
    }

    public static function environment_notice() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            return;
        }
        $page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
        if ( 'puente-verifactu' !== $page || ! PV_Woo_Settings::is_connected() ) {
            return;
        }
        $settings = PV_Woo_Settings::get();
        if ( 'test' !== ( $settings['environment'] ?? '' ) ) {
            return;
        }
        echo '<div class="notice notice-info"><p><strong>' . esc_html( self::ui( 'VeriFactu Software — AEAT TEST environment', 'VeriFactu Software — entorno AEAT TEST' ) ) . '</strong> · ' . esc_html( self::ui( 'This connection is for validation and does not enable AEAT production sending.', 'Esta conexión sirve para validación y no habilita el envío a AEAT producción.' ) ) . '</p></div>';
    }
}
