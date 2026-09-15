<?php

defined( 'ABSPATH' ) || exit;

final class PV_Woo_Settings {
    const OPTION = 'pv_woo_settings';

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
    }

    public static function menu() {
        add_submenu_page(
            'woocommerce',
            __( 'Puente VeriFactu', 'puente-verifactu-woocommerce' ),
            __( 'Puente VeriFactu', 'puente-verifactu-woocommerce' ),
            'manage_woocommerce',
            'puente-verifactu',
            array( __CLASS__, 'render' )
        );
    }

    public static function save() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            wp_die( esc_html__( 'You are not allowed to change these settings.', 'puente-verifactu-woocommerce' ) );
        }
        check_admin_referer( 'pv_woo_save_settings' );

        $endpoint = isset( $_POST['endpoint'] ) ? esc_url_raw( wp_unslash( $_POST['endpoint'] ) ) : '';
        $parts    = $endpoint ? wp_parse_url( $endpoint ) : array();
        if ( $endpoint && ( empty( $parts['scheme'] ) || 'https' !== strtolower( $parts['scheme'] ) ) ) {
            add_settings_error( 'pv_woo', 'endpoint', __( 'The Puente URL must use HTTPS.', 'puente-verifactu-woocommerce' ), 'error' );
            set_transient( 'settings_errors', get_settings_errors(), 30 );
            wp_safe_redirect( admin_url( 'admin.php?page=puente-verifactu' ) );
            exit;
        }

        $profile_id         = isset( $_POST['profile_id'] ) ? sanitize_key( wp_unslash( $_POST['profile_id'] ) ) : '';
        $refund_profile_id  = isset( $_POST['refund_profile_id'] ) ? sanitize_key( wp_unslash( $_POST['refund_profile_id'] ) ) : '';
        $tax_id_key         = isset( $_POST['tax_id_meta_key'] ) ? sanitize_key( wp_unslash( $_POST['tax_id_meta_key'] ) ) : '';
        $number_key         = isset( $_POST['invoice_number_meta_key'] ) ? sanitize_key( wp_unslash( $_POST['invoice_number_meta_key'] ) ) : '';
        $refund_number_key  = isset( $_POST['refund_invoice_number_meta_key'] ) ? sanitize_key( wp_unslash( $_POST['refund_invoice_number_meta_key'] ) ) : '';
        $number_source      = isset( $_POST['invoice_number_source'] ) ? sanitize_key( wp_unslash( $_POST['invoice_number_source'] ) ) : '';
        $auto_refunds       = ! empty( $_POST['auto_refunds'] );

        if ( ! in_array( $number_source, array( '', 'order_number', 'meta' ), true ) ) {
            $number_source = '';
        }
        if ( 'meta' === $number_source && '' === $number_key ) {
            add_settings_error( 'pv_woo', 'invoice_number', __( 'Invoice number meta key is required when that source is selected.', 'puente-verifactu-woocommerce' ), 'error' );
        }
        if ( $auto_refunds && ( '' === $refund_profile_id || '' === $refund_number_key ) ) {
            add_settings_error( 'pv_woo', 'refunds', __( 'Automatic refunds require a refund mapping profile and refund invoice number meta key.', 'puente-verifactu-woocommerce' ), 'error' );
            $auto_refunds = false;
        }

        $statuses = isset( $_POST['auto_statuses'] ) ? array_map( 'sanitize_key', (array) wp_unslash( $_POST['auto_statuses'] ) ) : array();
        $statuses = array_values( array_intersect( $statuses, array_keys( wc_get_order_statuses() ) ) );
        $statuses = array_map( static function ( $status ) { return preg_replace( '/^wc-/', '', $status ); }, $statuses );
        $timeout  = isset( $_POST['request_timeout'] ) ? absint( $_POST['request_timeout'] ) : 15;
        $timeout  = max( 5, min( 30, $timeout ) );

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

        if ( isset( $_POST['api_token'] ) && '' !== trim( (string) wp_unslash( $_POST['api_token'] ) ) ) {
            if ( ! PV_Woo_Secret_Store::save( trim( (string) wp_unslash( $_POST['api_token'] ) ) ) ) {
                add_settings_error( 'pv_woo', 'token', __( 'The API token could not be encrypted on this server.', 'puente-verifactu-woocommerce' ), 'error' );
            }
        }

        if ( ! empty( $_POST['clear_api_token'] ) ) {
            PV_Woo_Secret_Store::save( '' );
        }

        add_settings_error( 'pv_woo', 'saved', __( 'Puente VeriFactu settings saved.', 'puente-verifactu-woocommerce' ), 'updated' );
        set_transient( 'settings_errors', get_settings_errors(), 30 );
        wp_safe_redirect( admin_url( 'admin.php?page=puente-verifactu' ) );
        exit;
    }

    public static function render() {
        if ( ! current_user_can( 'manage_woocommerce' ) ) {
            return;
        }
        $settings = self::get();
        settings_errors( 'pv_woo' );
        $statuses = wc_get_order_statuses();
        ?>
        <div class="wrap">
            <h1><?php esc_html_e( 'Puente VeriFactu', 'puente-verifactu-woocommerce' ); ?></h1>
            <p><?php esc_html_e( 'WooCommerce sends neutral order data to Puente VeriFactu. Fiscal rules, AEAT XML, certificates and hash chains stay outside WordPress.', 'puente-verifactu-woocommerce' ); ?></p>
            <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
                <input type="hidden" name="action" value="pv_woo_save_settings">
                <?php wp_nonce_field( 'pv_woo_save_settings' ); ?>
                <table class="form-table" role="presentation">
                    <tr><th><label for="pv-endpoint"><?php esc_html_e( 'Puente URL', 'puente-verifactu-woocommerce' ); ?></label></th><td><input class="regular-text" id="pv-endpoint" name="endpoint" type="url" required value="<?php echo esc_attr( $settings['endpoint'] ); ?>" placeholder="https://verifactu.example.com"></td></tr>
                    <tr><th><label for="pv-profile"><?php esc_html_e( 'Mapping profile ID', 'puente-verifactu-woocommerce' ); ?></label></th><td><input class="regular-text" id="pv-profile" name="profile_id" type="text" required value="<?php echo esc_attr( $settings['profile_id'] ); ?>"></td></tr>
                    <tr><th><label for="pv-refund-profile"><?php esc_html_e( 'Refund mapping profile ID', 'puente-verifactu-woocommerce' ); ?></label></th><td><input class="regular-text" id="pv-refund-profile" name="refund_profile_id" type="text" value="<?php echo esc_attr( $settings['refund_profile_id'] ); ?>"><p class="description"><?php esc_html_e( 'Use a separate server-side profile for corrective invoices. WooCommerce never selects R1–R5 or S/I.', 'puente-verifactu-woocommerce' ); ?></p></td></tr>
                    <tr><th><label for="pv-token"><?php esc_html_e( 'API token', 'puente-verifactu-woocommerce' ); ?></label></th><td><input class="regular-text" id="pv-token" name="api_token" type="password" autocomplete="new-password" value="" placeholder="<?php echo esc_attr( PV_Woo_Secret_Store::get() ? __( 'Stored securely — leave blank to keep it', 'puente-verifactu-woocommerce' ) : __( 'Not configured', 'puente-verifactu-woocommerce' ) ); ?>"><br><label><input type="checkbox" name="clear_api_token" value="1"> <?php esc_html_e( 'Remove stored token', 'puente-verifactu-woocommerce' ); ?></label></td></tr>
                    <tr>
                        <th><label for="pv-number-source"><?php esc_html_e( 'Invoice number source', 'puente-verifactu-woocommerce' ); ?></label></th>
                        <td>
                            <select id="pv-number-source" name="invoice_number_source">
                                <option value="" <?php selected( '', $settings['invoice_number_source'] ); ?>><?php esc_html_e( 'Not configured — preflight will block', 'puente-verifactu-woocommerce' ); ?></option>
                                <option value="meta" <?php selected( 'meta', $settings['invoice_number_source'] ); ?>><?php esc_html_e( 'Order meta key from an invoice plugin', 'puente-verifactu-woocommerce' ); ?></option>
                                <option value="order_number" <?php selected( 'order_number', $settings['invoice_number_source'] ); ?>><?php esc_html_e( 'WooCommerce order number (explicitly use as invoice number)', 'puente-verifactu-woocommerce' ); ?></option>
                            </select>
                            <p class="description"><?php esc_html_e( 'WooCommerce orders are not automatically fiscal invoices. Choose the real invoice numbering source explicitly.', 'puente-verifactu-woocommerce' ); ?></p>
                        </td>
                    </tr>
                    <tr><th><label for="pv-number-meta"><?php esc_html_e( 'Invoice number meta key', 'puente-verifactu-woocommerce' ); ?></label></th><td><input class="regular-text" id="pv-number-meta" name="invoice_number_meta_key" type="text" value="<?php echo esc_attr( $settings['invoice_number_meta_key'] ); ?>"><p class="description"><?php esc_html_e( 'Required only when using an existing invoice plugin/meta field.', 'puente-verifactu-woocommerce' ); ?></p></td></tr>
                    <tr><th><label for="pv-refund-number-meta"><?php esc_html_e( 'Refund invoice number meta key', 'puente-verifactu-woocommerce' ); ?></label></th><td><input class="regular-text" id="pv-refund-number-meta" name="refund_invoice_number_meta_key" type="text" value="<?php echo esc_attr( $settings['refund_invoice_number_meta_key'] ); ?>"><p class="description"><?php esc_html_e( 'The corrective invoice must have its own fiscal number. No WooCommerce refund ID is used automatically.', 'puente-verifactu-woocommerce' ); ?></p></td></tr>
                    <tr><th><?php esc_html_e( 'Automatic statuses', 'puente-verifactu-woocommerce' ); ?></th><td><?php foreach ( $statuses as $key => $label ) : $slug = preg_replace( '/^wc-/', '', $key ); ?><label style="display:block"><input type="checkbox" name="auto_statuses[]" value="<?php echo esc_attr( $key ); ?>" <?php checked( in_array( $slug, $settings['auto_statuses'], true ) ); ?>> <?php echo esc_html( $label ); ?></label><?php endforeach; ?><p class="description"><?php esc_html_e( 'Leave all unchecked for manual-only mode.', 'puente-verifactu-woocommerce' ); ?></p></td></tr>
                    <tr><th><?php esc_html_e( 'Automatic refunds', 'puente-verifactu-woocommerce' ); ?></th><td><label><input type="checkbox" name="auto_refunds" value="1" <?php checked( ! empty( $settings['auto_refunds'] ) ); ?>> <?php esc_html_e( 'Queue new WooCommerce refunds for corrective-invoice preflight and submission.', 'puente-verifactu-woocommerce' ); ?></label><p class="description"><?php esc_html_e( 'Disabled by default. Enable only after the corrective mapping profile and refund invoice numbering are validated.', 'puente-verifactu-woocommerce' ); ?></p></td></tr>
                    <tr><th><label for="pv-tax-meta"><?php esc_html_e( 'Customer tax ID meta key', 'puente-verifactu-woocommerce' ); ?></label></th><td><input class="regular-text" id="pv-tax-meta" name="tax_id_meta_key" type="text" value="<?php echo esc_attr( $settings['tax_id_meta_key'] ); ?>"><p class="description"><?php esc_html_e( 'Optional. Use the meta key already used by your VAT/NIF plugin. The connector never assumes a third-party field name.', 'puente-verifactu-woocommerce' ); ?></p></td></tr>
                    <tr><th><label for="pv-timeout"><?php esc_html_e( 'HTTP timeout (seconds)', 'puente-verifactu-woocommerce' ); ?></label></th><td><input id="pv-timeout" name="request_timeout" type="number" min="5" max="30" value="<?php echo esc_attr( $settings['request_timeout'] ); ?>"></td></tr>
                </table>
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }
}
