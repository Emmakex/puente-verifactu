<?php

defined( 'ABSPATH' ) || exit;

final class PV_Woo_Connector {
    const META_RECORD_ID   = '_pv_record_id';
    const META_STATUS      = '_pv_status';
    const META_LAST_ERROR  = '_pv_last_error';
    const META_SYNCED_AT   = '_pv_last_synced_at';
    const META_PAYLOAD_SHA = '_pv_payload_sha256';
    const GROUP            = 'puente-verifactu';
    const MAX_ATTEMPTS     = 5;

    private static $instance;

    public static function instance() {
        if ( ! self::$instance ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function boot() {
        PV_Woo_Settings::register();
        add_action( 'woocommerce_order_status_changed', array( $this, 'status_changed' ), 20, 4 );
        add_action( 'pv_woo_process_order', array( $this, 'process_order' ), 10, 2 );
        add_action( 'pv_woo_reconcile_order', array( $this, 'reconcile_order' ), 10, 1 );
        add_filter( 'woocommerce_order_actions', array( $this, 'order_actions' ), 20, 2 );
        add_action( 'woocommerce_order_action_pv_woo_preflight', array( $this, 'manual_preflight' ) );
        add_action( 'woocommerce_order_action_pv_woo_send', array( $this, 'manual_send' ) );
        add_action( 'woocommerce_order_action_pv_woo_reconcile', array( $this, 'manual_reconcile' ) );
    }

    public function status_changed( $order_id, $from, $to, $order ) {
        $settings = PV_Woo_Settings::get();
        if ( ! in_array( sanitize_key( $to ), $settings['auto_statuses'], true ) ) {
            return;
        }
        if ( ! $order instanceof WC_Order ) {
            $order = wc_get_order( $order_id );
        }
        if ( ! $order ) {
            return;
        }
        if ( $order->get_meta( self::META_RECORD_ID, true ) ) {
            $this->enqueue( 'pv_woo_reconcile_order', array( (int) $order_id ) );
            return;
        }
        $this->enqueue( 'pv_woo_process_order', array( (int) $order_id, 0 ) );
    }

    public function order_actions( $actions, $order ) {
        $actions['pv_woo_preflight'] = __( 'Puente VeriFactu: validate without sending', 'puente-verifactu-woocommerce' );
        if ( $order instanceof WC_Order && $order->get_meta( self::META_RECORD_ID, true ) ) {
            $actions['pv_woo_reconcile'] = __( 'Puente VeriFactu: refresh status', 'puente-verifactu-woocommerce' );
        } else {
            $actions['pv_woo_send'] = __( 'Puente VeriFactu: send', 'puente-verifactu-woocommerce' );
        }
        return $actions;
    }

    public function manual_preflight( $order ) {
        if ( ! $order instanceof WC_Order ) {
            return;
        }
        $result = $this->preflight_order( $order );
        if ( is_wp_error( $result ) ) {
            $this->record_error( $order, $result );
            return;
        }
        if ( empty( $result['ok'] ) ) {
            $order->add_order_note( __( 'Puente VeriFactu preflight found data that must be corrected before sending.', 'puente-verifactu-woocommerce' ) );
            $order->update_meta_data( self::META_STATUS, 'blocked' );
            $order->save();
            return;
        }
        $order->add_order_note( __( 'Puente VeriFactu preflight passed. Nothing was sent to AEAT.', 'puente-verifactu-woocommerce' ) );
        $order->update_meta_data( self::META_STATUS, 'preflight_valid' );
        $order->delete_meta_data( self::META_LAST_ERROR );
        $order->save();
    }

    public function manual_send( $order ) {
        if ( ! $order instanceof WC_Order ) {
            return;
        }
        $this->enqueue( 'pv_woo_process_order', array( (int) $order->get_id(), 0 ) );
        $order->add_order_note( __( 'Puente VeriFactu send queued.', 'puente-verifactu-woocommerce' ) );
    }

    public function manual_reconcile( $order ) {
        if ( $order instanceof WC_Order ) {
            $this->enqueue( 'pv_woo_reconcile_order', array( (int) $order->get_id() ) );
        }
    }

    public function process_order( $order_id, $attempt = 0 ) {
        $order = wc_get_order( $order_id );
        if ( ! $order ) {
            return;
        }
        if ( $order->get_meta( self::META_RECORD_ID, true ) ) {
            $this->reconcile_order( $order_id );
            return;
        }

        $settings = PV_Woo_Settings::get();
        $client   = new PV_Woo_Client( $settings );
        $payload  = PV_Woo_Order_Payload::build( $order, $settings );
        $preflight = $client->preflight( $payload );
        if ( is_wp_error( $preflight ) ) {
            $this->handle_failure( $order, $preflight, $attempt );
            return;
        }
        if ( empty( $preflight['ok'] ) ) {
            $error = new WP_Error( 'pv_preflight_blocked', __( 'Preflight failed. The order was not fiscalized.', 'puente-verifactu-woocommerce' ), array( 'retryable' => false ) );
            $this->record_error( $order, $error );
            $order->update_meta_data( self::META_STATUS, 'blocked' );
            $order->save();
            return;
        }

        $result = $client->issue( $payload, $this->idempotency_key( $order ) );
        if ( is_wp_error( $result ) ) {
            $this->handle_failure( $order, $result, $attempt );
            return;
        }

        if ( empty( $result['recordId'] ) ) {
            $this->record_error( $order, new WP_Error( 'pv_record_missing', __( 'Puente VeriFactu did not return a record ID.', 'puente-verifactu-woocommerce' ) ) );
            return;
        }

        $order->update_meta_data( self::META_RECORD_ID, sanitize_text_field( $result['recordId'] ) );
        $order->update_meta_data( self::META_STATUS, sanitize_key( isset( $result['status'] ) ? $result['status'] : 'fiscalized' ) );
        $order->update_meta_data( self::META_SYNCED_AT, gmdate( 'c' ) );
        $order->update_meta_data( self::META_PAYLOAD_SHA, hash( 'sha256', wp_json_encode( $payload ) ) );
        $order->delete_meta_data( self::META_LAST_ERROR );
        $order->save();
        $order->add_order_note( sprintf( __( 'Puente VeriFactu created record %s.', 'puente-verifactu-woocommerce' ), sanitize_text_field( $result['recordId'] ) ) );
    }

    public function reconcile_order( $order_id ) {
        $order = wc_get_order( $order_id );
        if ( ! $order ) {
            return;
        }
        $record_id = (string) $order->get_meta( self::META_RECORD_ID, true );
        if ( '' === $record_id ) {
            return;
        }
        $client = new PV_Woo_Client( PV_Woo_Settings::get() );
        $result = $client->status( $record_id );
        if ( is_wp_error( $result ) ) {
            $this->record_error( $order, $result );
            return;
        }
        $status = sanitize_key( isset( $result['status'] ) ? $result['status'] : 'unknown' );
        $order->update_meta_data( self::META_STATUS, $status );
        $order->update_meta_data( self::META_SYNCED_AT, gmdate( 'c' ) );
        $order->delete_meta_data( self::META_LAST_ERROR );
        $order->save();
    }

    private function preflight_order( WC_Order $order ) {
        $settings = PV_Woo_Settings::get();
        $client = new PV_Woo_Client( $settings );
        return $client->preflight( PV_Woo_Order_Payload::build( $order, $settings ) );
    }

    private function handle_failure( WC_Order $order, WP_Error $error, $attempt ) {
        $this->record_error( $order, $error );
        $data = $error->get_error_data();
        $retryable = is_array( $data ) && ! empty( $data['retryable'] );
        $attempt = (int) $attempt;
        if ( $retryable && $attempt + 1 < self::MAX_ATTEMPTS ) {
            $delays = array( 60, 300, 900, 3600, 10800 );
            $delay  = $delays[ min( $attempt, count( $delays ) - 1 ) ];
            $this->schedule( 'pv_woo_process_order', time() + $delay, array( (int) $order->get_id(), $attempt + 1 ) );
            $order->update_meta_data( self::META_STATUS, 'retry_scheduled' );
            $order->save();
        }
    }

    private function record_error( WC_Order $order, WP_Error $error ) {
        $order->update_meta_data( self::META_LAST_ERROR, sanitize_text_field( $error->get_error_code() . ': ' . $error->get_error_message() ) );
        if ( ! $order->get_meta( self::META_STATUS, true ) ) {
            $order->update_meta_data( self::META_STATUS, 'blocked' );
        }
        $order->save();
    }

    private function idempotency_key( WC_Order $order ) {
        return sprintf( 'woo:%d:order:%d:issue:v1', get_current_blog_id(), $order->get_id() );
    }

    private function enqueue( $hook, array $args ) {
        if ( function_exists( 'as_enqueue_async_action' ) && did_action( 'action_scheduler_init' ) ) {
            as_enqueue_async_action( $hook, $args, self::GROUP, true );
            return;
        }
        if ( ! wp_next_scheduled( $hook, $args ) ) {
            wp_schedule_single_event( time() + 1, $hook, $args );
        }
    }

    private function schedule( $hook, $timestamp, array $args ) {
        if ( function_exists( 'as_schedule_single_action' ) && did_action( 'action_scheduler_init' ) ) {
            as_schedule_single_action( $timestamp, $hook, $args, self::GROUP, true );
            return;
        }
        if ( ! wp_next_scheduled( $hook, $args ) ) {
            wp_schedule_single_event( $timestamp, $hook, $args );
        }
    }
}
