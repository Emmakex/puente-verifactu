<?php

defined( 'ABSPATH' ) || exit;

final class PV_Woo_Settings {
    const OPTION = 'pv_woo_settings';
    const CUSTOMER_ENDPOINT = 'https://kairoseth.com/api/fiscal';
    const CONNECTION_PREFIX = 'KFS1.';

    public static function get() {
        $defaults = array(
            'endpoint'                       => '',
            'profile_id'                     => '',
            'refund_profile_id'              => '',
            'auto_statuses'                  => array(),
            'auto_refunds'                   => false,
            'tax_id_meta_key'                => '',
            'invoice_number_source'          => '',
            'invoice_number_meta_key'        => '',
            'refund_invoice_number_meta_key' => '',
            'request_timeout'                => 15,
        );
        $settings = get_option( self::OPTION, array() );
        return wp_parse_args( is_array( $settings ) ? $settings : array(), $defaults );
    }

    public static function register() {
        add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
        add_action( 'admin_post_pv_woo_save_settings', array( __CLASS__, 'save' ) );
        add_action( 'admin_post_pv_woo_connect', array( __CLASS__, 'connect' ) );
        add_action( 'admin_post_pv_woo_disconnect', array( __CLASS__, 'disconnect' ) );
    }

    public static function menu() {
        add_submenu_page(
            'woocommerce',
            'VeriFactu Software',
            'VeriFactu Software',
            'manage_woocommerce',
            'puente-verifactu',
            array( __CLASS__, 'render' )
        );
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

    public static function is_connected( array $settings = null ) {
        $settings = null === $settings ? self::get() : $settings;
        return 0 === strpos( (string) $settings['endpoint'], 'https://' )
            && '' !== (string) $settings['profile_id']
            && '' !== (string) PV_Woo_Secret_Store::get();
    }

    private static function parse_connection_key( $key ) {
        $key = trim( (string) $key );
        if ( 0 !== strpos( $key, self::CONNECTION_PREFIX ) ) {
            return new WP_Error( 'pv_connection_key_format', self::ui( 'The connection key is not valid.', 'La clave de conexión no es válida.' ) );
        }

        $encoded = substr( $key, strlen( self::CONNECTION_PREFIX ) );
        if ( '' === $encoded || strlen( $encoded ) > 4096 || ! preg_match( '/^[A-Za-z0-9_-]+$/', $encoded ) ) {
            return new WP_Error( 'pv_connection_key_format', self::ui( 'The connection key is not valid.', 'La clave de conexión no es válida.' ) );
        }

        $base64 = strtr( $encoded, '-_', '+/' );
        $padding = strlen( $base64 ) % 4;
        if ( $padding ) {
            $base64 .= str_repeat( '=', 4 - $padding );
        }
        $decoded = base64_decode( $base64, true );
        $payload = false === $decoded ? null : json_decode( $decoded, true );
        if ( ! is_array( $payload ) || 1 !== (int) ( $payload['v'] ?? 0 ) ) {
            return new WP_Error( 'pv_connection_key_payload', self::ui( 'The connection key payload is not valid.', 'El contenido de la clave de conexión no es válido.' ) );
        }

        $profile_id = sanitize_key( (string) ( $payload['profileId'] ?? '' ) );
        $refund_profile_id = sanitize_key( (string) ( $payload['refundProfileId'] ?? '' ) );
        $token = trim( (string) ( $payload['token'] ?? '' ) );

        if ( ! preg_match( '/^int_[a-f0-9]{32}$/', $profile_id ) ) {
            return new WP_Error( 'pv_connection_profile', self::ui( 'The connection key does not contain a valid integration profile.', 'La clave de conexión no contiene un perfil de integración válido.' ) );
        }
        if ( '' !== $refund_profile_id && ! preg_match( '/^int_[a-f0-9]{32}$/', $refund_profile_id ) ) {
            return new WP_Error( 'pv_connection_refund_profile', self::ui( 'The corrective-invoice profile is not valid.', 'El perfil de facturas rectificativas no es válido.' ) );
        }
        if ( strlen( $token ) < 32 || strlen( $token ) > 2048 || preg_match( '/[\r\n]/', $token ) ) {
            return new WP_Error( 'pv_connection_token', self::ui( 'The connection credential is not valid.', 'La credencial de conexión no es válida.' ) );
        }

        return array(
            'profile_id'        => $profile_id,
            'refund_profile_id' => $refund_profile_id,
            'token'             => $token,
        );
    }

    public static function connect() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html( self::ui( 'You are not allowed to connect this store.', 'No tienes permisos para conectar esta tienda.' ) ) );
        }
        check_admin_referer( 'pv_woo_connect' );

        $parsed = self::parse_connection_key( isset( $_POST['connection_key'] ) ? wp_unslash( $_POST['connection_key'] ) : '' );
        if ( is_wp_error( $parsed ) ) {
            add_settings_error( 'pv_woo', 'connection', $parsed->get_error_message(), 'error' );
            set_transient( 'settings_errors', get_settings_errors(), 30 );
            self::redirect();
        }

        if ( ! PV_Woo_Secret_Store::save( $parsed['token'] ) ) {
            add_settings_error( 'pv_woo', 'connection_token', self::ui( 'The connection credential could not be stored securely on this server.', 'La credencial de conexión no pudo guardarse de forma segura en este servidor.' ), 'error' );
            set_transient( 'settings_errors', get_settings_errors(), 30 );
            self::redirect();
        }

        $settings = self::get();
        $settings['endpoint'] = self::CUSTOMER_ENDPOINT;
        $settings['profile_id'] = $parsed['profile_id'];
        $settings['refund_profile_id'] = $parsed['refund_profile_id'];
        update_option( self::OPTION, $settings, false );

        add_settings_error( 'pv_woo', 'connected', self::ui( 'VeriFactu Software connection settings installed. Run a preflight on a test order before enabling automatic sending.', 'VeriFactu Software ha quedado configurado. Haz un preflight con un pedido de prueba antes de activar el envío automático.' ), 'updated' );
        set_transient( 'settings_errors', get_settings_errors(), 30 );
        self::redirect();
    }

    public static function disconnect() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html( self::ui( 'You are not allowed to disconnect this store.', 'No tienes permisos para desconectar esta tienda.' ) ) );
        }
        check_admin_referer( 'pv_woo_disconnect' );

        $settings = self::get();
        $settings['endpoint'] = '';
        $settings['profile_id'] = '';
        $settings['refund_profile_id'] = '';
        $settings['auto_statuses'] = array();
        $settings['auto_refunds'] = false;
        update_option( self::OPTION, $settings, false );
        PV_Woo_Secret_Store::save( '' );

        add_settings_error( 'pv_woo', 'disconnected', self::ui( 'VeriFactu Software was disconnected from this store.', 'VeriFactu Software se ha desconectado de esta tienda.' ), 'updated' );
        set_transient( 'settings_errors', get_settings_errors(), 30 );
        self::redirect();
    }

    public static function save() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html( self::ui( 'You are not allowed to change these settings.', 'No tienes permisos para cambiar estos ajustes.' ) ) );
        }
        check_admin_referer( 'pv_woo_save_settings' );

        $current = self::get();
        $advanced = ! empty( $_POST['advanced_mode'] );

        $endpoint = $advanced && isset( $_POST['endpoint'] )
            ? esc_url_raw( wp_unslash( $_POST['endpoint'] ) )
            : (string) $current['endpoint'];
        $parts = $endpoint ? wp_parse_url( $endpoint ) : array();
        if ( $endpoint && ( empty( $parts['scheme'] ) || 'https' !== strtolower( $parts['scheme'] ) ) ) {
            add_settings_error( 'pv_woo', 'endpoint', self::ui( 'The Puente URL must use HTTPS.', 'La URL de Puente debe usar HTTPS.' ), 'error' );
            set_transient( 'settings_errors', get_settings_errors(), 30 );
            self::redirect();
        }

        $profile_id = $advanced && isset( $_POST['profile_id'] )
            ? sanitize_key( wp_unslash( $_POST['profile_id'] ) )
            : (string) $current['profile_id'];
        $refund_profile_id = $advanced && isset( $_POST['refund_profile_id'] )
            ? sanitize_key( wp_unslash( $_POST['refund_profile_id'] ) )
            : (string) $current['refund_profile_id'];

        $tax_id_key = isset( $_POST['tax_id_meta_key'] )
            ? sanitize_key( wp_unslash( $_POST['tax_id_meta_key'] ) )
            : (string) $current['tax_id_meta_key'];
        $number_key = isset( $_POST['invoice_number_meta_key'] )
            ? sanitize_key( wp_unslash( $_POST['invoice_number_meta_key'] ) )
            : (string) $current['invoice_number_meta_key'];
        $refund_number_key = isset( $_POST['refund_invoice_number_meta_key'] )
            ? sanitize_key( wp_unslash( $_POST['refund_invoice_number_meta_key'] ) )
            : (string) $current['refund_invoice_number_meta_key'];
        $number_source = isset( $_POST['invoice_number_source'] )
            ? sanitize_key( wp_unslash( $_POST['invoice_number_source'] ) )
            : (string) $current['invoice_number_source'];
        $auto_refunds = ! empty( $_POST['auto_refunds'] );

        if ( ! in_array( $number_source, array( '', 'order_number', 'meta' ), true ) ) {
            $number_source = '';
        }
        if ( 'meta' === $number_source && '' === $number_key ) {
            add_settings_error( 'pv_woo', 'invoice_number', self::ui( 'Your invoice plugin field must be configured before using it as the fiscal invoice number.', 'Debes configurar el campo de tu plugin de facturación antes de usarlo como número de factura fiscal.' ), 'error' );
        }
        if ( $auto_refunds && ( '' === $refund_profile_id || '' === $refund_number_key ) ) {
            add_settings_error( 'pv_woo', 'refunds', self::ui( 'Automatic refunds require a validated corrective-invoice profile and numbering source.', 'Los reembolsos automáticos requieren un perfil de factura rectificativa validado y su numeración.' ), 'error' );
            $auto_refunds = false;
        }

        if ( $advanced ) {
            $statuses = isset( $_POST['auto_statuses'] ) ? array_map( 'sanitize_key', (array) wp_unslash( $_POST['auto_statuses'] ) ) : array();
            $statuses = array_values( array_intersect( $statuses, array_keys( wc_get_order_statuses() ) ) );
            $statuses = array_map( static function ( $status ) { return preg_replace( '/^wc-/', '', $status ); }, $statuses );
        } else {
            $statuses = ! empty( $_POST['send_when_completed'] ) ? array( 'completed' ) : array();
        }

        $timeout = $advanced && isset( $_POST['request_timeout'] ) ? absint( $_POST['request_timeout'] ) : (int) $current['request_timeout'];
        $timeout = max( 5, min( 30, $timeout ) );

        update_option(
            self::OPTION,
            array(
                'endpoint'                       => untrailingslashit( $endpoint ),
                'profile_id'                     => $profile_id,
                'refund_profile_id'              => $refund_profile_id,
                'auto_statuses'                  => $statuses,
                'auto_refunds'                   => $auto_refunds,
                'tax_id_meta_key'                => $tax_id_key,
                'invoice_number_source'          => $number_source,
                'invoice_number_meta_key'        => $number_key,
                'refund_invoice_number_meta_key' => $refund_number_key,
                'request_timeout'                => $timeout,
            ),
            false
        );

        if ( $advanced && isset( $_POST['api_token'] ) && '' !== trim( (string) wp_unslash( $_POST['api_token'] ) ) ) {
            if ( ! PV_Woo_Secret_Store::save( trim( (string) wp_unslash( $_POST['api_token'] ) ) ) ) {
                add_settings_error( 'pv_woo', 'token', self::ui( 'The API token could not be encrypted on this server.', 'El token de API no pudo cifrarse en este servidor.' ), 'error' );
            }
        }
        if ( $advanced && ! empty( $_POST['clear_api_token'] ) ) {
            PV_Woo_Secret_Store::save( '' );
        }

        add_settings_error( 'pv_woo', 'saved', self::ui( 'VeriFactu Software settings saved.', 'Ajustes de VeriFactu Software guardados.' ), 'updated' );
        set_transient( 'settings_errors', get_settings_errors(), 30 );
        self::redirect();
    }

    private static function card_open( $title ) {
        echo '<div style="background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:20px 24px;margin:18px 0;max-width:900px;box-shadow:0 1px 2px rgba(0,0,0,.04)">';
        echo '<h2 style="margin-top:0">' . esc_html( $title ) . '</h2>';
    }

    private static function card_close() {
        echo '</div>';
    }

    public static function render() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            return;
        }
        $settings = self::get();
        $connected = self::is_connected( $settings );
        $advanced = isset( $_GET['pv_advanced'] ) && '1' === sanitize_text_field( wp_unslash( $_GET['pv_advanced'] ) );
        settings_errors( 'pv_woo' );
        $statuses = wc_get_order_statuses();
        ?>
        <div class="wrap">
            <h1>VeriFactu Software</h1>
            <p style="font-size:14px;max-width:900px"><?php echo esc_html( self::ui( 'Connect WooCommerce to VeriFactu without moving your fiscal logic, certificates or AEAT credentials into WordPress.', 'Conecta WooCommerce con VeriFactu sin guardar en WordPress la lógica fiscal, los certificados ni las credenciales de AEAT.' ) ); ?></p>

            <?php self::card_open( self::ui( 'Connection', 'Conexión' ) ); ?>
            <?php if ( $connected ) : ?>
                <p><span style="display:inline-block;background:#edfaef;color:#116329;border:1px solid #b8e6c1;border-radius:999px;padding:5px 10px;font-weight:600">● <?php echo esc_html( self::ui( 'Configured', 'Configurado' ) ); ?></span></p>
                <p><?php echo esc_html( self::ui( 'This store has VeriFactu Software credentials installed. Validate a test order with Preflight before enabling automatic sending.', 'Esta tienda tiene instaladas las credenciales de VeriFactu Software. Valida un pedido de prueba con Preflight antes de activar el envío automático.' ) ); ?></p>
                <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline-block;margin-right:8px">
                    <input type="hidden" name="action" value="pv_woo_disconnect">
                    <?php wp_nonce_field( 'pv_woo_disconnect' ); ?>
                    <?php submit_button( self::ui( 'Disconnect store', 'Desconectar tienda' ), 'secondary', 'submit', false ); ?>
                </form>
            <?php else : ?>
                <p><?php echo esc_html( self::ui( 'Paste the connection key provided by VeriFactu Software. You do not need to configure URLs, profile IDs or API tokens.', 'Pega la clave de conexión proporcionada por VeriFactu Software. No necesitas configurar URLs, IDs de perfil ni tokens de API.' ) ); ?></p>
                <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
                    <input type="hidden" name="action" value="pv_woo_connect">
                    <?php wp_nonce_field( 'pv_woo_connect' ); ?>
                    <p><label for="pv-connection-key"><strong><?php echo esc_html( self::ui( 'Connection key', 'Clave de conexión' ) ); ?></strong></label></p>
                    <input class="regular-text" style="width:min(100%,620px)" id="pv-connection-key" name="connection_key" type="password" autocomplete="off" required placeholder="KFS1.…">
                    <p><?php submit_button( self::ui( 'Connect with VeriFactu Software', 'Conectar con VeriFactu Software' ), 'primary', 'submit', false ); ?></p>
                </form>
                <p class="description"><?php echo esc_html( self::ui( 'The connection key is issued for this store and contains the scoped integration credential. Never share it publicly.', 'La clave se emite para esta tienda y contiene una credencial limitada a esta integración. No la compartas públicamente.' ) ); ?></p>
            <?php endif; ?>
            <?php self::card_close(); ?>

            <?php if ( $connected ) : ?>
                <?php self::card_open( self::ui( 'Invoicing', 'Facturación' ) ); ?>
                <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
                    <input type="hidden" name="action" value="pv_woo_save_settings">
                    <?php wp_nonce_field( 'pv_woo_save_settings' ); ?>
                    <table class="form-table" role="presentation">
                        <tr>
                            <th><label for="pv-number-source"><?php echo esc_html( self::ui( 'Invoice numbering', 'Numeración de facturas' ) ); ?></label></th>
                            <td>
                                <select id="pv-number-source" name="invoice_number_source">
                                    <option value="" <?php selected( '', $settings['invoice_number_source'] ); ?>><?php echo esc_html( self::ui( 'Choose how your invoices are numbered', 'Elige cómo se numeran tus facturas' ) ); ?></option>
                                    <option value="order_number" <?php selected( 'order_number', $settings['invoice_number_source'] ); ?>><?php echo esc_html( self::ui( 'Use the WooCommerce order number as the invoice number', 'Usar el número de pedido de WooCommerce como número de factura' ) ); ?></option>
                                    <option value="meta" <?php selected( 'meta', $settings['invoice_number_source'] ); ?>><?php echo esc_html( self::ui( 'Use my existing invoicing plugin', 'Usar mi plugin de facturación actual' ) ); ?></option>
                                </select>
                                <p class="description"><?php echo esc_html( self::ui( 'Only choose the order number if it is really the fiscal invoice number used by your business.', 'Elige el número de pedido solo si realmente es el número fiscal de factura que utiliza tu negocio.' ) ); ?></p>
                            </td>
                        </tr>
                        <?php if ( 'meta' === $settings['invoice_number_source'] || $advanced ) : ?>
                            <tr><th><label for="pv-number-meta"><?php echo esc_html( self::ui( 'Invoice plugin field', 'Campo del plugin de facturación' ) ); ?></label></th><td><input class="regular-text" id="pv-number-meta" name="invoice_number_meta_key" type="text" value="<?php echo esc_attr( $settings['invoice_number_meta_key'] ); ?>"><p class="description"><?php echo esc_html( self::ui( 'Advanced: internal WooCommerce meta key where your invoicing plugin stores the invoice number.', 'Avanzado: meta-key interna donde tu plugin de facturación guarda el número de factura.' ) ); ?></p></td></tr>
                        <?php endif; ?>
                        <tr>
                            <th><?php echo esc_html( self::ui( 'Automatic sending', 'Envío automático' ) ); ?></th>
                            <td><label><input type="checkbox" name="send_when_completed" value="1" <?php checked( in_array( 'completed', $settings['auto_statuses'], true ) ); ?>> <?php echo esc_html( self::ui( 'Send automatically when the WooCommerce order is completed', 'Enviar automáticamente cuando el pedido de WooCommerce esté completado' ) ); ?></label><p class="description"><?php echo esc_html( self::ui( 'Keep this disabled until a manual Preflight has passed on a test order.', 'Déjalo desactivado hasta que un Preflight manual haya sido correcto en un pedido de prueba.' ) ); ?></p></td>
                        </tr>
                        <?php if ( '' !== $settings['refund_profile_id'] ) : ?>
                            <tr><th><?php echo esc_html( self::ui( 'Corrective invoices', 'Facturas rectificativas' ) ); ?></th><td><label><input type="checkbox" name="auto_refunds" value="1" <?php checked( ! empty( $settings['auto_refunds'] ) ); ?>> <?php echo esc_html( self::ui( 'Process WooCommerce refunds automatically after validation', 'Procesar automáticamente los reembolsos de WooCommerce después de validarlos' ) ); ?></label></td></tr>
                        <?php endif; ?>
                    </table>
                    <?php submit_button( self::ui( 'Save invoicing settings', 'Guardar configuración de facturación' ) ); ?>
                </form>
                <?php self::card_close(); ?>
            <?php endif; ?>

            <p style="max-width:900px"><a href="<?php echo esc_url( admin_url( 'admin.php?page=puente-verifactu&pv_advanced=' . ( $advanced ? '0' : '1' ) ) ); ?>"><?php echo esc_html( $advanced ? self::ui( 'Hide advanced settings', 'Ocultar ajustes avanzados' ) : self::ui( 'Advanced settings', 'Ajustes avanzados' ) ); ?></a></p>

            <?php if ( $advanced ) : ?>
                <?php self::card_open( self::ui( 'Advanced integration settings', 'Ajustes avanzados de integración' ) ); ?>
                <p class="description"><?php echo esc_html( self::ui( 'For support and custom integrations. Normal customers should not need these fields.', 'Solo para soporte e integraciones personalizadas. Un cliente normal no debería necesitar estos campos.' ) ); ?></p>
                <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
                    <input type="hidden" name="action" value="pv_woo_save_settings">
                    <input type="hidden" name="advanced_mode" value="1">
                    <?php wp_nonce_field( 'pv_woo_save_settings' ); ?>
                    <table class="form-table" role="presentation">
                        <tr><th><label for="pv-endpoint"><?php echo esc_html( self::ui( 'Bridge URL', 'URL de Puente' ) ); ?></label></th><td><input class="regular-text" id="pv-endpoint" name="endpoint" type="url" value="<?php echo esc_attr( $settings['endpoint'] ); ?>"></td></tr>
                        <tr><th><label for="pv-profile"><?php echo esc_html( self::ui( 'Mapping profile ID', 'ID del perfil de mapeo' ) ); ?></label></th><td><input class="regular-text" id="pv-profile" name="profile_id" type="text" value="<?php echo esc_attr( $settings['profile_id'] ); ?>"></td></tr>
                        <tr><th><label for="pv-refund-profile"><?php echo esc_html( self::ui( 'Corrective mapping profile ID', 'ID del perfil de mapeo para rectificativas' ) ); ?></label></th><td><input class="regular-text" id="pv-refund-profile" name="refund_profile_id" type="text" value="<?php echo esc_attr( $settings['refund_profile_id'] ); ?>"></td></tr>
                        <tr><th><label for="pv-token"><?php echo esc_html( self::ui( 'API token', 'Token de API' ) ); ?></label></th><td><input class="regular-text" id="pv-token" name="api_token" type="password" autocomplete="new-password" value="" placeholder="<?php echo esc_attr( PV_Woo_Secret_Store::get() ? self::ui( 'Stored securely — leave blank to keep it', 'Guardado de forma segura — déjalo vacío para conservarlo' ) : self::ui( 'Not configured', 'No configurado' ) ); ?>"><br><label><input type="checkbox" name="clear_api_token" value="1"> <?php echo esc_html( self::ui( 'Remove stored token', 'Eliminar token guardado' ) ); ?></label></td></tr>
                        <tr><th><label for="pv-number-source-advanced"><?php echo esc_html( self::ui( 'Invoice number source', 'Fuente del número de factura' ) ); ?></label></th><td><select id="pv-number-source-advanced" name="invoice_number_source"><option value="" <?php selected( '', $settings['invoice_number_source'] ); ?>><?php echo esc_html( self::ui( 'Not configured — preflight will block', 'Sin configurar — el preflight bloqueará el envío' ) ); ?></option><option value="meta" <?php selected( 'meta', $settings['invoice_number_source'] ); ?>><?php echo esc_html( self::ui( 'Order meta key from an invoice plugin', 'Meta-key de un plugin de facturación' ) ); ?></option><option value="order_number" <?php selected( 'order_number', $settings['invoice_number_source'] ); ?>><?php echo esc_html( self::ui( 'WooCommerce order number', 'Número de pedido de WooCommerce' ) ); ?></option></select></td></tr>
                        <tr><th><label for="pv-number-meta-advanced"><?php echo esc_html( self::ui( 'Invoice number meta key', 'Meta-key del número de factura' ) ); ?></label></th><td><input class="regular-text" id="pv-number-meta-advanced" name="invoice_number_meta_key" type="text" value="<?php echo esc_attr( $settings['invoice_number_meta_key'] ); ?>"></td></tr>
                        <tr><th><label for="pv-refund-number-meta"><?php echo esc_html( self::ui( 'Corrective invoice number meta key', 'Meta-key del número de factura rectificativa' ) ); ?></label></th><td><input class="regular-text" id="pv-refund-number-meta" name="refund_invoice_number_meta_key" type="text" value="<?php echo esc_attr( $settings['refund_invoice_number_meta_key'] ); ?>"></td></tr>
                        <tr><th><?php echo esc_html( self::ui( 'Automatic statuses', 'Estados automáticos' ) ); ?></th><td><?php foreach ( $statuses as $key => $label ) : $slug = preg_replace( '/^wc-/', '', $key ); ?><label style="display:block"><input type="checkbox" name="auto_statuses[]" value="<?php echo esc_attr( $key ); ?>" <?php checked( in_array( $slug, $settings['auto_statuses'], true ) ); ?>> <?php echo esc_html( $label ); ?></label><?php endforeach; ?></td></tr>
                        <tr><th><?php echo esc_html( self::ui( 'Automatic refunds', 'Reembolsos automáticos' ) ); ?></th><td><label><input type="checkbox" name="auto_refunds" value="1" <?php checked( ! empty( $settings['auto_refunds'] ) ); ?>> <?php echo esc_html( self::ui( 'Queue refunds for corrective-invoice processing', 'Encolar reembolsos para procesarlos como factura rectificativa' ) ); ?></label></td></tr>
                        <tr><th><label for="pv-tax-meta"><?php echo esc_html( self::ui( 'Customer tax ID meta key', 'Meta-key del NIF/CIF del cliente' ) ); ?></label></th><td><input class="regular-text" id="pv-tax-meta" name="tax_id_meta_key" type="text" value="<?php echo esc_attr( $settings['tax_id_meta_key'] ); ?>"></td></tr>
                        <tr><th><label for="pv-timeout"><?php echo esc_html( self::ui( 'HTTP timeout (seconds)', 'Timeout HTTP (segundos)' ) ); ?></label></th><td><input id="pv-timeout" name="request_timeout" type="number" min="5" max="30" value="<?php echo esc_attr( $settings['request_timeout'] ); ?>"></td></tr>
                    </table>
                    <?php submit_button( self::ui( 'Save advanced settings', 'Guardar ajustes avanzados' ) ); ?>
                </form>
                <?php self::card_close(); ?>
            <?php endif; ?>

            <p class="description" style="max-width:900px"><?php echo esc_html( self::ui( 'Technical engine: Puente VeriFactu. Fiscal rules, AEAT XML, certificates and hash chains remain server-side in VeriFactu Software.', 'Motor técnico: Puente VeriFactu. Las reglas fiscales, XML de AEAT, certificados y cadena de huellas permanecen en VeriFactu Software, fuera de WordPress.' ) ); ?></p>
        </div>
        <?php
    }
}
