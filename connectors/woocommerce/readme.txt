=== Puente VeriFactu for WooCommerce ===
Contributors: emmakex
Tags: verifactu, woocommerce, invoicing, aeat, accounting
Requires at least: 6.5
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.2.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connect WooCommerce to Puente VeriFactu without implementing AEAT fiscal logic inside WordPress.

== Description ==

Puente VeriFactu for WooCommerce is a lightweight connector. It reads WooCommerce orders and refunds through the official CRUD APIs, sends neutral source data to Puente VeriFactu, and stores normalized record/status references back on the order.

Fiscal classification, AEAT XML, certificates, hashes and chaining remain server-side in Puente VeriFactu.

The connector includes manual preflight/send/reconcile actions, optional asynchronous automation, corrective-refund support through a separate server-side MappingProfile, HPOS compatibility, idempotency and an operational traffic-light column.

Spanish UI translations are bundled. Full technical documentation in Spanish is included in README.md.

Important: the repository is not production-ready while the external AEAT test gate remains open. Do not interpret the plugin as tax or legal advice.

== Installation ==

1. Install and activate WooCommerce.
2. Upload the Puente VeriFactu plugin ZIP and activate it.
3. Open WooCommerce -> Puente VeriFactu.
4. Configure the HTTPS Puente URL, server-side MappingProfile ID and Bearer token.
5. Configure the real fiscal invoice-number source explicitly.
6. Run manual preflight before enabling automatic statuses.
7. For refunds, validate a separate corrective MappingProfile and refund invoice numbering before enabling automatic refunds.

== Changelog ==

= 0.2.0 =
* Added explicit WooCommerce refunds/corrective-operation flow.
* Added HPOS/legacy traffic-light status column.
* Added separate corrective MappingProfile and refund numbering configuration.
* Added sync-error degradation from green to amber.
* Added reproducible release packaging and compatibility validation metadata.

= 0.1.0 =
* Initial HPOS-safe WooCommerce connector foundation.
