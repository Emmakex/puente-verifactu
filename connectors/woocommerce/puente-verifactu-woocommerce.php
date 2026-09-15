<?php
/**
 * Plugin Name: Puente VeriFactu for WooCommerce
 * Plugin URI: https://github.com/Emmakex/puente-verifactu
 * Description: Connects WooCommerce orders to Puente VeriFactu without implementing AEAT fiscal logic inside WordPress.
 * Version: 0.1.0
 * Author: Kairoseth Extensions
 * Text Domain: puente-verifactu-woocommerce
 * Domain Path: /languages
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * WC requires at least: 8.2
 * WC tested up to: 11.1
 * License: GPL-2.0-or-later
 */

defined( 'ABSPATH' ) || exit;

define( 'PV_WOO_VERSION', '0.1.0' );
define( 'PV_WOO_FILE', __FILE__ );
define( 'PV_WOO_PATH', plugin_dir_path( __FILE__ ) );

add_action(
    'before_woocommerce_init',
    static function () {
        if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
            \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
        }
    }
);

add_action(
    'plugins_loaded',
    static function () {
        if ( ! class_exists( 'WooCommerce' ) ) {
            add_action(
                'admin_notices',
                static function () {
                    if ( current_user_can( 'activate_plugins' ) ) {
                        echo '<div class="notice notice-error"><p>' . esc_html__( 'Puente VeriFactu for WooCommerce requires WooCommerce to be active.', 'puente-verifactu-woocommerce' ) . '</p></div>';
                    }
                }
            );
            return;
        }

        require_once PV_WOO_PATH . 'includes/class-pv-woo-settings.php';
        require_once PV_WOO_PATH . 'includes/class-pv-woo-client.php';
        require_once PV_WOO_PATH . 'includes/class-pv-woo-order-payload.php';
        require_once PV_WOO_PATH . 'includes/class-pv-woo-connector.php';

        PV_Woo_Connector::instance()->boot();
    },
    20
);

register_deactivation_hook(
    __FILE__,
    static function () {
        if ( function_exists( 'as_unschedule_all_actions' ) ) {
            as_unschedule_all_actions( 'pv_woo_process_order', array(), 'puente-verifactu' );
            as_unschedule_all_actions( 'pv_woo_reconcile_order', array(), 'puente-verifactu' );
        }
    }
);
