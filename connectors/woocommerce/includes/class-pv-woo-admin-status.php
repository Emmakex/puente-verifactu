<?php

defined( 'ABSPATH' ) || exit;

final class PV_Woo_Admin_Status {
    const COLUMN = 'pv_verifactu';

    public static function register() {
        add_filter( 'manage_woocommerce_page_wc-orders_columns', array( __CLASS__, 'columns' ) );
        add_action( 'manage_woocommerce_page_wc-orders_custom_column', array( __CLASS__, 'render_hpos' ), 20, 2 );
        add_filter( 'manage_edit-shop_order_columns', array( __CLASS__, 'columns' ) );
        add_action( 'manage_shop_order_posts_custom_column', array( __CLASS__, 'render_legacy' ), 20, 1 );
        add_action( 'admin_head', array( __CLASS__, 'styles' ) );
    }

    public static function columns( $columns ) {
        if ( ! is_array( $columns ) ) {
            return $columns;
        }
        $columns[ self::COLUMN ] = __( 'VeriFactu', 'puente-verifactu-woocommerce' );
        return $columns;
    }

    public static function render_hpos( $column, $order ) {
        if ( self::COLUMN !== $column ) {
            return;
        }
        if ( ! ( $order instanceof WC_Order ) ) {
            $order = wc_get_order( $order );
        }
        self::render( $order );
    }

    public static function render_legacy( $column ) {
        if ( self::COLUMN !== $column ) {
            return;
        }
        global $post;
        $order = $post ? wc_get_order( $post->ID ) : false;
        self::render( $order );
    }

    private static function render( $order ) {
        if ( ! ( $order instanceof WC_Order ) || $order instanceof WC_Order_Refund ) {
            echo '<span class="pv-vf-status pv-vf-status--gray">● ' . esc_html__( 'Not available', 'puente-verifactu-woocommerce' ) . '</span>';
            return;
        }

        $summary = self::summary( $order );
        printf(
            '<span class="pv-vf-status pv-vf-status--%1$s" title="%2$s">● %3$s</span>',
            esc_attr( $summary['level'] ),
            esc_attr( $summary['detail'] ),
            esc_html( $summary['label'] )
        );
    }

    public static function summary( WC_Order $order ) {
        $statuses = array();
        $has_sync_error = '' !== trim( (string) $order->get_meta( PV_Woo_Connector::META_LAST_ERROR, true ) );
        $base = sanitize_key( (string) $order->get_meta( PV_Woo_Connector::META_STATUS, true ) );
        if ( '' !== $base ) {
            $statuses[] = $base;
        }

        $refund_count = 0;
        foreach ( $order->get_refunds() as $refund ) {
            $refund_count++;
            $status = sanitize_key( (string) $refund->get_meta( PV_Woo_Connector::META_STATUS, true ) );
            $statuses[] = '' === $status ? 'refund_pending' : $status;
            if ( '' !== trim( (string) $refund->get_meta( PV_Woo_Connector::META_LAST_ERROR, true ) ) ) {
                $has_sync_error = true;
            }
        }

        $level = 'gray';
        foreach ( $statuses as $status ) {
            $candidate = self::level_for_status( $status );
            if ( self::weight( $candidate ) > self::weight( $level ) ) {
                $level = $candidate;
            }
        }

        if ( empty( $statuses ) ) {
            $level = 'gray';
        }
        if ( $has_sync_error && self::weight( 'amber' ) > self::weight( $level ) ) {
            $level = 'amber';
        }

        $labels = array(
            'green' => __( 'Synced', 'puente-verifactu-woocommerce' ),
            'amber' => __( 'Pending / review', 'puente-verifactu-woocommerce' ),
            'red'   => __( 'Action required', 'puente-verifactu-woocommerce' ),
            'gray'  => __( 'Not sent', 'puente-verifactu-woocommerce' ),
        );

        $detail = empty( $statuses ) ? __( 'No Puente VeriFactu operation exists yet.', 'puente-verifactu-woocommerce' ) : implode( ', ', $statuses );
        if ( $refund_count > 0 ) {
            $detail .= ' · ' . sprintf( _n( '%d refund', '%d refunds', $refund_count, 'puente-verifactu-woocommerce' ), $refund_count );
        }
        if ( $has_sync_error ) {
            $detail .= ' · ' . __( 'Pending / review', 'puente-verifactu-woocommerce' );
        }

        return array(
            'level'  => $level,
            'label'  => $labels[ $level ],
            'detail' => $detail,
        );
    }

    private static function level_for_status( $status ) {
        if ( in_array( $status, array( 'accepted' ), true ) ) {
            return 'green';
        }
        if ( in_array( $status, array( 'blocked', 'rejected', 'aeat_rejected', 'failed' ), true ) ) {
            return 'red';
        }
        if ( in_array( $status, array( 'received', 'preflight_valid', 'fiscalized', 'queued', 'sending', 'retry_scheduled', 'accepted_with_errors', 'refund_pending', 'unknown' ), true ) ) {
            return 'amber';
        }
        return 'amber';
    }

    private static function weight( $level ) {
        $weights = array( 'gray' => 0, 'green' => 1, 'amber' => 2, 'red' => 3 );
        return isset( $weights[ $level ] ) ? $weights[ $level ] : 2;
    }

    public static function styles() {
        echo '<style>.column-pv_verifactu{width:145px}.pv-vf-status{font-weight:600;white-space:nowrap}.pv-vf-status--green{color:#137333}.pv-vf-status--amber{color:#8a5a00}.pv-vf-status--red{color:#b42318}.pv-vf-status--gray{color:#646970}</style>';
    }
}
