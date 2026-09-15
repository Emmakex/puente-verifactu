<?php

defined( 'ABSPATH' ) || exit;

final class PV_Woo_Refund_Payload {
    public static function build( WC_Order_Refund $refund, WC_Order $order, array $settings ) {
        $date = $refund->get_date_created();
        $refund_date = $date ? $date->date( 'Y-m-d' ) : gmdate( 'Y-m-d' );
        $refund_date = trim( (string) apply_filters( 'pv_woo_refund_invoice_date', $refund_date, $refund, $order, $settings ) );

        $number = '';
        if ( ! empty( $settings['refund_invoice_number_meta_key'] ) ) {
            $number = trim( (string) $refund->get_meta( $settings['refund_invoice_number_meta_key'], true ) );
        }
        $number = trim( (string) apply_filters( 'pv_woo_refund_invoice_number', $number, $refund, $order, $settings ) );

        $payload = array(
            'connector_schema'        => 1,
            'source_invoice_id'       => 'woo:' . get_current_blog_id() . ':refund:' . $refund->get_id(),
            'refund_id'               => (string) $refund->get_id(),
            'parent_order_id'         => (string) $order->get_id(),
            'refund_invoice_number'   => $number,
            'refund_date'             => $refund_date,
            'description'             => sprintf( 'WooCommerce refund %d for order %s', $refund->get_id(), $order->get_order_number() ),
            'reason'                  => (string) $refund->get_reason(),
            'currency'                => (string) $order->get_currency(),
            'customer_name'           => PV_Woo_Order_Payload::customer_name( $order ),
            'customer_tax_id'         => PV_Woo_Order_Payload::customer_tax_id( $order, $settings ),
            'original_invoice_number' => PV_Woo_Order_Payload::invoice_number( $order, $settings ),
            'original_invoice_date'   => PV_Woo_Order_Payload::invoice_date( $order, $settings ),
            'total_amount'            => PV_Woo_Order_Payload::money( $refund->get_total() ),
            'tax_amount'              => PV_Woo_Order_Payload::money( $refund->get_total_tax() ),
            'tax_lines'               => self::tax_lines( $refund, $order ),
        );

        return apply_filters( 'pv_woo_refund_source_payload', $payload, $refund, $order, $settings );
    }

    private static function tax_lines( WC_Order_Refund $refund, WC_Order $order ) {
        $rates = array();
        foreach ( $order->get_taxes() as $tax_item ) {
            $rates[ (string) $tax_item->get_rate_id() ] = PV_Woo_Order_Payload::rate( $tax_item->get_rate_percent() );
        }

        $lines = array();
        foreach ( array( 'line_item', 'shipping', 'fee' ) as $type ) {
            foreach ( $refund->get_items( $type ) as $item ) {
                if ( ! method_exists( $item, 'get_taxes' ) || ! method_exists( $item, 'get_total' ) ) {
                    continue;
                }
                $taxes  = $item->get_taxes();
                $totals = isset( $taxes['total'] ) && is_array( $taxes['total'] ) ? $taxes['total'] : array();
                foreach ( $totals as $rate_id => $tax_amount ) {
                    $key = (string) $rate_id;
                    if ( ! isset( $lines[ $key ] ) ) {
                        $lines[ $key ] = array(
                            'rate'       => isset( $rates[ $key ] ) ? $rates[ $key ] : '',
                            'baseAmount' => '0.00',
                            'taxAmount'  => '0.00',
                        );
                    }
                    $lines[ $key ]['baseAmount'] = PV_Woo_Order_Payload::decimal_add( $lines[ $key ]['baseAmount'], PV_Woo_Order_Payload::money( $item->get_total() ) );
                    $lines[ $key ]['taxAmount']  = PV_Woo_Order_Payload::decimal_add( $lines[ $key ]['taxAmount'], PV_Woo_Order_Payload::money( $tax_amount ) );
                }
            }
        }

        if ( empty( $lines ) ) {
            $total = PV_Woo_Order_Payload::money( $refund->get_total() );
            $tax   = PV_Woo_Order_Payload::money( $refund->get_total_tax() );
            $base  = PV_Woo_Order_Payload::decimal_add( $total, self::negate( $tax ) );
            $lines['0'] = array(
                'rate'       => '0',
                'baseAmount' => $base,
                'taxAmount'  => $tax,
            );
        }

        return array_values( $lines );
    }

    private static function negate( $amount ) {
        $value = trim( (string) $amount );
        if ( '' === $value || preg_match( '/^-?0(?:\.0+)?$/', $value ) ) {
            return '0.00';
        }
        return 0 === strpos( $value, '-' ) ? substr( $value, 1 ) : '-' . $value;
    }
}
