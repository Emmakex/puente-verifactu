<?php

defined( 'ABSPATH' ) || exit;

function pvWooNativeFail( $code, $message, $details = array() ) {
    fwrite(
        STDERR,
        wp_json_encode(
            array(
                'schema_version' => 2,
                'status'         => 'failed',
                'check'          => 'woocommerce-native-reconciliation-v2',
                'code'           => $code,
                'message'        => $message,
                'details'        => $details,
            ),
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
        ) . PHP_EOL
    );
    exit( 1 );
}

$expected_scenarios = array(
    'invoice.existing-retryable-no-reissue',
    'invoice.existing-nonretryable-no-reissue',
    'invoice.new-retryable-idempotency-stable',
    'corrective.existing-retryable-no-reissue',
    'corrective.existing-nonretryable-no-reissue',
    'corrective.new-retryable-idempotency-stable',
);
$passed = array();

update_option(
    PV_Woo_Settings::OPTION,
    array(
        'endpoint'                       => 'https://bridge.contract.invalid',
        'profile_id'                     => 'native-contract-invoice',
        'refund_profile_id'              => 'native-contract-corrective',
        'auto_statuses'                  => array(),
        'auto_refunds'                   => false,
        'tax_id_meta_key'                => '',
        'invoice_number_source'          => 'order_number',
        'invoice_number_meta_key'        => '',
        'refund_invoice_number_meta_key' => '_pv_native_refund_number',
        'request_timeout'                => 5,
    ),
    false
);
if ( ! PV_Woo_Secret_Store::save( 'native-contract-token' ) ) {
    pvWooNativeFail( 'WOO_NATIVE_SECRET_STORE_FAILED', 'Could not seed the encrypted API token.' );
}

$transport = array(
    'mode'  => 'success',
    'calls' => array(),
);

$filter = static function ( $preempt, $args, $url ) use ( &$transport ) {
    if ( 0 !== strpos( (string) $url, 'https://bridge.contract.invalid' ) ) {
        return $preempt;
    }

    $method = strtoupper( isset( $args['method'] ) ? (string) $args['method'] : 'GET' );
    $transport['calls'][] = array(
        'method'  => $method,
        'url'     => (string) $url,
        'headers' => isset( $args['headers'] ) && is_array( $args['headers'] ) ? $args['headers'] : array(),
        'body'    => isset( $args['body'] ) ? (string) $args['body'] : '',
    );

    if ( 'retryable-all' === $transport['mode'] ) {
        return new WP_Error( 'native_contract_offline', 'Native contract transport unavailable.' );
    }

    $path = (string) wp_parse_url( $url, PHP_URL_PATH );
    if ( 'POST' === $method && '/v1/preflight' === $path ) {
        return array(
            'headers'  => array(),
            'body'     => wp_json_encode( array( 'ok' => true, 'mode' => 'dry-run' ) ),
            'response' => array( 'code' => 200, 'message' => 'OK' ),
            'cookies'  => array(),
        );
    }

    if ( 'issue-retryable' === $transport['mode'] && 'POST' === $method && '/v1/fiscal-records' === $path ) {
        return new WP_Error( 'native_contract_issue_offline', 'Native contract issue unavailable.' );
    }

    if ( 'GET' === $method && 0 === strpos( $path, '/v1/fiscal-records/' ) ) {
        return array(
            'headers'  => array(),
            'body'     => wp_json_encode( array( 'recordId' => basename( $path ), 'status' => 'accepted' ) ),
            'response' => array( 'code' => 200, 'message' => 'OK' ),
            'cookies'  => array(),
        );
    }

    if ( 'POST' === $method && '/v1/fiscal-records' === $path ) {
        return array(
            'headers'  => array(),
            'body'     => wp_json_encode( array( 'recordId' => 'fr_contract123', 'status' => 'created' ) ),
            'response' => array( 'code' => 202, 'message' => 'Accepted' ),
            'cookies'  => array(),
        );
    }

    return new WP_Error( 'native_contract_unexpected_call', 'Unexpected native contract URL: ' . $url );
};
add_filter( 'pre_http_request', $filter, 10, 3 );

$reset_calls = static function ( $mode ) use ( &$transport ) {
    $transport['mode']  = $mode;
    $transport['calls'] = array();
};
$get_issue_calls = static function () use ( &$transport ) {
    return array_values(
        array_filter(
            $transport['calls'],
            static function ( $call ) {
                return 'POST' === $call['method'] && '/v1/fiscal-records' === (string) wp_parse_url( $call['url'], PHP_URL_PATH );
            }
        )
    );
};
$get_status_calls = static function () use ( &$transport ) {
    return array_values(
        array_filter(
            $transport['calls'],
            static function ( $call ) {
                return 'GET' === $call['method'] && 0 === strpos( (string) wp_parse_url( $call['url'], PHP_URL_PATH ), '/v1/fiscal-records/' );
            }
        )
    );
};
$get_idempotency = static function ( $call ) {
    if ( ! is_array( $call ) || empty( $call['headers'] ) ) {
        return '';
    }
    foreach ( $call['headers'] as $name => $value ) {
        if ( 'idempotency-key' === strtolower( (string) $name ) ) {
            return (string) $value;
        }
    }
    return '';
};

$product = new WC_Product_Simple();
$product->set_name( 'Native contract product' );
$product->set_regular_price( '10.00' );
$product->set_price( '10.00' );
$product->set_status( 'publish' );
$product->save();

$order = wc_create_order();
if ( is_wp_error( $order ) || ! ( $order instanceof WC_Order ) ) {
    pvWooNativeFail( 'WOO_NATIVE_ORDER_CREATE_FAILED', 'Could not create the native contract order.' );
}
$order->set_currency( 'EUR' );
$order->set_billing_first_name( 'Native' );
$order->set_billing_last_name( 'Contract' );
$order->add_product( $product, 1 );
$order->calculate_totals();
$order->save();
$connector = PV_Woo_Connector::instance();

// New invoice + retryable issue: the same order must reuse the same deterministic key.
$order->delete_meta_data( PV_Woo_Connector::META_RECORD_ID );
$order->delete_meta_data( PV_Woo_Connector::META_STATUS );
$order->delete_meta_data( PV_Woo_Connector::META_LAST_ERROR );
$order->save();
$reset_calls( 'issue-retryable' );
$connector->process_order( $order->get_id(), 4 );
$first_issue_calls = $get_issue_calls();
if ( 1 !== count( $first_issue_calls ) ) {
    pvWooNativeFail( 'WOO_NATIVE_INVOICE_FIRST_ISSUE_COUNT', 'Expected exactly one first invoice issue attempt.', $transport['calls'] );
}
$invoice_key_one = $get_idempotency( $first_issue_calls[0] );
$reset_calls( 'issue-retryable' );
$connector->process_order( $order->get_id(), 4 );
$second_issue_calls = $get_issue_calls();
$invoice_key_two = 1 === count( $second_issue_calls ) ? $get_idempotency( $second_issue_calls[0] ) : '';
if ( '' === $invoice_key_one || $invoice_key_one !== $invoice_key_two ) {
    pvWooNativeFail( 'WOO_NATIVE_INVOICE_RETRY_KEY', 'Retrying the same invoice changed its idempotency key.' );
}
$passed[] = 'invoice.new-retryable-idempotency-stable';

// Existing invoice + retryable status failure: status only, record identity preserved, zero POST issues.
$order = wc_get_order( $order->get_id() );
$order->update_meta_data( PV_Woo_Connector::META_RECORD_ID, 'fr_abc123' );
$order->update_meta_data( PV_Woo_Connector::META_STATUS, 'accepted' );
$order->save();
$reset_calls( 'retryable-all' );
$connector->process_order( $order->get_id(), 0 );
$order = wc_get_order( $order->get_id() );
if ( 'fr_abc123' !== $order->get_meta( PV_Woo_Connector::META_RECORD_ID, true )
    || 1 !== count( $get_status_calls() )
    || 0 !== count( $get_issue_calls() ) ) {
    pvWooNativeFail( 'WOO_NATIVE_INVOICE_EXISTING_RETRYABLE', 'Existing invoice retryable status failure attempted an unsafe fallback.', $transport['calls'] );
}
$passed[] = 'invoice.existing-retryable-no-reissue';

// Existing invoice + nonretryable invalid record id: no network call and no issue fallback.
$order->update_meta_data( PV_Woo_Connector::META_RECORD_ID, 'invalid-existing-record' );
$order->save();
$reset_calls( 'success' );
$connector->process_order( $order->get_id(), 0 );
$order = wc_get_order( $order->get_id() );
if ( 'invalid-existing-record' !== $order->get_meta( PV_Woo_Connector::META_RECORD_ID, true )
    || 0 !== count( $transport['calls'] ) ) {
    pvWooNativeFail( 'WOO_NATIVE_INVOICE_EXISTING_NONRETRYABLE', 'Invalid existing invoice record fell through to a remote issue path.', $transport['calls'] );
}
$passed[] = 'invoice.existing-nonretryable-no-reissue';

// Build one real WooCommerce refund for corrective scenarios.
$order->update_meta_data( PV_Woo_Connector::META_RECORD_ID, 'fr_abcd01' );
$order->save();
$refund = wc_create_refund(
    array(
        'amount'         => '1.00',
        'reason'         => 'Native contract corrective',
        'order_id'       => $order->get_id(),
        'refund_payment' => false,
        'restock_items'  => false,
    )
);
if ( is_wp_error( $refund ) || ! ( $refund instanceof WC_Order_Refund ) ) {
    pvWooNativeFail( 'WOO_NATIVE_REFUND_CREATE_FAILED', 'Could not create a native WooCommerce refund.', is_wp_error( $refund ) ? $refund->get_error_messages() : array() );
}
$refund->update_meta_data( '_pv_native_refund_number', 'CR-' . $refund->get_id() );
$refund->save();

// New corrective + retryable issue keeps exactly one deterministic refund key.
$refund->delete_meta_data( PV_Woo_Connector::META_RECORD_ID );
$refund->delete_meta_data( PV_Woo_Connector::META_STATUS );
$refund->delete_meta_data( PV_Woo_Connector::META_LAST_ERROR );
$refund->save();
$reset_calls( 'issue-retryable' );
$connector->process_refund( $refund->get_id(), 4 );
$first_refund_issue = $get_issue_calls();
if ( 1 !== count( $first_refund_issue ) ) {
    pvWooNativeFail( 'WOO_NATIVE_REFUND_FIRST_ISSUE_COUNT', 'Expected exactly one first corrective issue attempt.', $transport['calls'] );
}
$refund_key_one = $get_idempotency( $first_refund_issue[0] );
$reset_calls( 'issue-retryable' );
$connector->process_refund( $refund->get_id(), 4 );
$second_refund_issue = $get_issue_calls();
$refund_key_two = 1 === count( $second_refund_issue ) ? $get_idempotency( $second_refund_issue[0] ) : '';
if ( '' === $refund_key_one || $refund_key_one !== $refund_key_two ) {
    pvWooNativeFail( 'WOO_NATIVE_REFUND_RETRY_KEY', 'Retrying the same corrective changed its idempotency key.' );
}
$passed[] = 'corrective.new-retryable-idempotency-stable';

// Existing corrective + retryable status failure: reconcile only.
$refund = wc_get_order( $refund->get_id() );
$refund->update_meta_data( PV_Woo_Connector::META_RECORD_ID, 'fr_abc456' );
$refund->update_meta_data( PV_Woo_Connector::META_STATUS, 'accepted' );
$refund->save();
$reset_calls( 'retryable-all' );
$connector->process_refund( $refund->get_id(), 0 );
$refund = wc_get_order( $refund->get_id() );
if ( 'fr_abc456' !== $refund->get_meta( PV_Woo_Connector::META_RECORD_ID, true )
    || 1 !== count( $get_status_calls() )
    || 0 !== count( $get_issue_calls() ) ) {
    pvWooNativeFail( 'WOO_NATIVE_REFUND_EXISTING_RETRYABLE', 'Existing corrective retryable status failure attempted an unsafe fallback.', $transport['calls'] );
}
$passed[] = 'corrective.existing-retryable-no-reissue';

// Existing corrective + nonretryable invalid record id: no network issue path.
$refund->update_meta_data( PV_Woo_Connector::META_RECORD_ID, 'invalid-corrective-record' );
$refund->save();
$reset_calls( 'success' );
$connector->process_refund( $refund->get_id(), 0 );
$refund = wc_get_order( $refund->get_id() );
if ( 'invalid-corrective-record' !== $refund->get_meta( PV_Woo_Connector::META_RECORD_ID, true )
    || 0 !== count( $transport['calls'] ) ) {
    pvWooNativeFail( 'WOO_NATIVE_REFUND_EXISTING_NONRETRYABLE', 'Invalid existing corrective record fell through to a remote issue path.', $transport['calls'] );
}
$passed[] = 'corrective.existing-nonretryable-no-reissue';

remove_filter( 'pre_http_request', $filter, 10 );
sort( $expected_scenarios );
sort( $passed );
if ( $passed !== $expected_scenarios ) {
    pvWooNativeFail( 'WOO_NATIVE_SCENARIOS_INCOMPLETE', 'WooCommerce did not pass every native reconciliation v2 scenario.', array( 'passed' => $passed ) );
}

echo wp_json_encode(
    array(
        'schema_version' => 2,
        'status'         => 'ok',
        'check'          => 'woocommerce-native-reconciliation-v2',
        'wordpress'      => get_bloginfo( 'version' ),
        'woocommerce'    => defined( 'WC_VERSION' ) ? WC_VERSION : '',
        'plugin'         => PV_WOO_VERSION,
        'scenarios'      => $passed,
    ),
    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
) . PHP_EOL;
