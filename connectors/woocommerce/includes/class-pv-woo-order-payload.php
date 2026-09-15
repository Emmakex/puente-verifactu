<?php

defined( 'ABSPATH' ) || exit;

final class PV_Woo_Order_Payload {
    public static function build( WC_Order $order, array $settings ) {
        $date = $order->get_date_created();
        $name = trim( $order->get_billing_company() );
        if ( '' === $name ) {
            $name = trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() );
        }
        if ( '' === $name ) {
            $name = __( 'WooCommerce customer', 'puente-verifactu-woocommerce' );
        }

        $tax_id = '';
        if ( ! empty( $settings['tax_id_meta_key'] ) ) {
            $tax_id = trim( (string) $order->get_meta( $settings['tax_id_meta_key'], true ) );
        }
        $tax_id = (string) apply_filters( 'pv_woo_customer_tax_id', $tax_id, $order );

        $invoice_number = self::invoice_number( $order, $settings );

        $payload = array(
            'connector_schema' => 1,
            'source_invoice_id'=> 'woo:' . get_current_blog_id() . ':order:' . $order->get_id(),
            'order_id'         => (string) $order->get_id(),
            'order_number'     => (string) $order->get_order_number(),
            'invoice_number'   => $invoice_number,
            'order_date'       => $date ? $date->date( 'Y-m-d' ) : gmdate( 'Y-m-d' ),
            'description'      => sprintf( 'WooCommerce order %s', $order->get_order_number() ),
            'currency'         => (string) $order->get_currency(),
            'customer_name'    => $name,
            'customer_tax_id'  => $tax_id,
            'total_amount'     => self::money( $order->get_total() ),
            'discount_amount'  => self::money( $order->get_discount_total() ),
            'shipping_amount'  => self::money( $order->get_shipping_total() ),
            'tax_amount'       => self::money( $order->get_total_tax() ),
            'tax_lines'        => self::tax_lines( $order ),
        );

        return apply_filters( 'pv_woo_order_source_payload', $payload, $order, $settings );
    }

    private static function invoice_number( WC_Order $order, array $settings ) {
        $source = isset( $settings['invoice_number_source'] ) ? (string) $settings['invoice_number_source'] : '';
        $number = '';

        if ( 'order_number' === $source ) {
            $number = (string) $order->get_order_number();
        } elseif ( 'meta' === $source && ! empty( $settings['invoice_number_meta_key'] ) ) {
            $number = trim( (string) $order->get_meta( $settings['invoice_number_meta_key'], true ) );
        }

        return trim( (string) apply_filters( 'pv_woo_invoice_number', $number, $order, $settings ) );
    }

    private static function tax_lines( WC_Order $order ) {
        $rates = array();
        foreach ( $order->get_taxes() as $tax_item ) {
            $rate_id = (string) $tax_item->get_rate_id();
            $rates[ $rate_id ] = self::rate( $tax_item->get_rate_percent() );
        }

        $lines = array();
        foreach ( array( 'line_item', 'shipping', 'fee' ) as $type ) {
            foreach ( $order->get_items( $type ) as $item ) {
                if ( ! method_exists( $item, 'get_taxes' ) || ! method_exists( $item, 'get_total' ) ) {
                    continue;
                }
                $taxes = $item->get_taxes();
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
                    $lines[ $key ]['baseAmount'] = self::decimal_add( $lines[ $key ]['baseAmount'], self::money( $item->get_total() ) );
                    $lines[ $key ]['taxAmount']  = self::decimal_add( $lines[ $key ]['taxAmount'], self::money( $tax_amount ) );
                }
            }
        }

        if ( empty( $lines ) ) {
            $base = self::decimal_add( self::money( $order->get_total() ), '-' . ltrim( self::money( $order->get_total_tax() ), '-' ) );
            $lines['0'] = array(
                'rate'       => '0',
                'baseAmount' => $base,
                'taxAmount'  => '0.00',
            );
        }

        return array_values( $lines );
    }

    private static function money( $value ) {
        return wc_format_decimal( $value, wc_get_price_decimals(), false );
    }

    private static function rate( $value ) {
        $formatted = wc_format_decimal( $value, 4, true );
        return '' === $formatted ? '0' : $formatted;
    }

    private static function decimal_add( $left, $right ) {
        $scale = 4;
        $a = self::scaled_int( $left, $scale );
        $b = self::scaled_int( $right, $scale );
        return self::from_scaled_int( $a + $b, $scale );
    }

    private static function scaled_int( $value, $scale ) {
        $text = trim( (string) $value );
        $negative = 0 === strpos( $text, '-' );
        $text = ltrim( $text, '+-' );
        $parts = explode( '.', $text, 2 );
        $whole = preg_replace( '/\D/', '', $parts[0] );
        $fraction = isset( $parts[1] ) ? preg_replace( '/\D/', '', $parts[1] ) : '';
        $fraction = substr( str_pad( $fraction, $scale, '0' ), 0, $scale );
        $value_int = (int) ( ( (int) ( '' === $whole ? '0' : $whole ) ) * ( 10 ** $scale ) + (int) $fraction );
        return $negative ? -$value_int : $value_int;
    }

    private static function from_scaled_int( $value, $scale ) {
        $negative = $value < 0;
        $absolute = abs( (int) $value );
        $factor = 10 ** $scale;
        $whole = intdiv( $absolute, $factor );
        $fraction = str_pad( (string) ( $absolute % $factor ), $scale, '0', STR_PAD_LEFT );
        $fraction = rtrim( $fraction, '0' );
        if ( strlen( $fraction ) < 2 ) {
            $fraction = str_pad( $fraction, 2, '0' );
        }
        return ( $negative ? '-' : '' ) . $whole . '.' . $fraction;
    }
}
