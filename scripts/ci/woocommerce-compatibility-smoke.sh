#!/usr/bin/env bash
set -euo pipefail

: "${WP_VERSION:?WP_VERSION is required}"
: "${WOO_VERSION:?WOO_VERSION is required}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
WP_PATH="$WORK/wordpress"
PLUGIN_ZIP="$WORK/puente-verifactu-woocommerce.zip"
trap 'rm -rf "$WORK"' EXIT

node "$ROOT/scripts/release/package-woocommerce.mjs" --output "$PLUGIN_ZIP"

wp core download --version="$WP_VERSION" --path="$WP_PATH" --force --quiet
wp config create \
  --path="$WP_PATH" \
  --dbname=wordpress \
  --dbuser=root \
  --dbpass=root \
  --dbhost=127.0.0.1:3306 \
  --skip-check \
  --quiet
wp core install \
  --path="$WP_PATH" \
  --url=http://puente.test \
  --title='Puente Compatibility' \
  --admin_user=admin \
  --admin_password='compat-only-password' \
  --admin_email=compat@example.invalid \
  --skip-email \
  --quiet

wp plugin install woocommerce --version="$WOO_VERSION" --activate --path="$WP_PATH" --quiet
wp option update woocommerce_custom_orders_table_enabled yes --path="$WP_PATH" --quiet
wp plugin install "$PLUGIN_ZIP" --activate --path="$WP_PATH" --quiet

wp eval --path="$WP_PATH" '
if ( ! class_exists( "PV_Woo_Connector" )
    || ! class_exists( "PV_Woo_Admin_Status" )
    || ! class_exists( "PV_Woo_Invoice_Presentation" )
    || ! function_exists( "pv_woo_get_invoice_presentation" ) ) {
    throw new RuntimeException( "Puente VeriFactu classes did not load" );
}
if ( ! class_exists( "\\Automattic\\WooCommerce\\Utilities\\OrderUtil" ) ) {
    throw new RuntimeException( "WooCommerce OrderUtil is unavailable" );
}
if ( ! \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled() ) {
    throw new RuntimeException( "HPOS was not enabled for compatibility smoke" );
}
if ( false === has_action( "woocommerce_order_refunded", array( PV_Woo_Connector::instance(), "order_refunded" ) ) ) {
    throw new RuntimeException( "Refund hook is not registered" );
}
$order = wc_create_order();
$order->set_currency( "EUR" );
$order->set_billing_first_name( "Compatibility" );
$order->save();
$payload = PV_Woo_Order_Payload::build(
    $order,
    array(
        "invoice_number_source" => "order_number",
        "invoice_number_meta_key" => "",
        "tax_id_meta_key" => "",
    )
);
if ( empty( $payload["invoice_number"] ) || "EUR" !== $payload["currency"] ) {
    throw new RuntimeException( "Neutral WooCommerce payload contract failed" );
}
$order->update_meta_data( PV_Woo_Connector::META_STATUS, "accepted" );
$order->save();
$reloaded = wc_get_order( $order->get_id() );
if ( "accepted" !== $reloaded->get_meta( PV_Woo_Connector::META_STATUS, true ) ) {
    throw new RuntimeException( "HPOS CRUD metadata roundtrip failed" );
}

$presentation_result = array(
    "presentation" => array(
        "mode" => "VERI*FACTU",
        "qr" => array(
            "url" => "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=VF-1&fecha=03-10-2026&importe=1.00",
            "prefixText" => "QR tributario:",
            "errorCorrection" => "M",
            "minSizeMm" => 30,
            "maxSizeMm" => 40,
        ),
        "verificationText" => "Factura verificable en la sede electrónica de la AEAT",
        "specificationVersion" => "0.5.0",
    ),
);
$stored_presentation = PV_Woo_Invoice_Presentation::store( $reloaded, $presentation_result );
if ( is_wp_error( $stored_presentation ) ) {
    throw new RuntimeException( "Neutral presentation contract could not be stored" );
}
$reloaded->save();
$presentation_order = wc_get_order( $order->get_id() );
$presentation = pv_woo_get_invoice_presentation( $presentation_order );
if ( ! is_array( $presentation )
    || "VERI*FACTU" !== $presentation["mode"]
    || "M" !== $presentation["error_correction"]
    || "0.5.0" !== $presentation["specification_version"] ) {
    throw new RuntimeException( "Neutral presentation contract CRUD roundtrip failed" );
}
echo "PV_WOO_COMPAT_OK\n";
'

wp eval-file --path="$WP_PATH" "$ROOT/scripts/ci/woocommerce-native-reconciliation-v2.php"

printf '{"schema_version":2,"status":"ok","check":"woocommerce-compatibility-and-native-reconciliation-v2","wordpress":"%s","woocommerce":"%s"}\n' "$WP_VERSION" "$WOO_VERSION"
