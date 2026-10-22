=== Kairoseth Fiscal for WooCommerce ===
Contributors: emmakex
Tags: verifactu, woocommerce, invoicing, aeat, accounting
Requires at least: 6.5
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.4.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connect WooCommerce to Kairoseth Fiscal / Puente VeriFactu without moving AEAT fiscal logic, certificates or hash chains into WordPress.

== Description ==

Kairoseth Fiscal for WooCommerce is the customer-facing connector for the Puente VeriFactu engine. It reads WooCommerce orders and refunds through the official CRUD APIs, sends neutral source data to Kairoseth Fiscal, and stores normalized record/status references back on the order.

The normal customer flow uses one scoped Kairoseth Fiscal connection key. Customers do not need to configure bridge URLs, MappingProfile IDs or API tokens manually. Technical fields remain available only under Advanced settings for support and custom integrations.

Fiscal classification, AEAT XML, certificates, hashes and chaining remain server-side in Kairoseth Fiscal / Puente VeriFactu.

The connector includes manual preflight/send/reconcile actions, optional asynchronous automation, corrective-refund support through a separate server-side MappingProfile, HPOS compatibility, idempotency and an operational traffic-light column.

Important: automatic sending should remain disabled until a manual Preflight has passed with a controlled test order. The plugin is not tax or legal advice.

== Installation ==

1. Install and activate WooCommerce.
2. Upload the Kairoseth Fiscal plugin ZIP and activate it.
3. Open WooCommerce -> Kairoseth Fiscal.
4. Paste the scoped connection key issued for the store and click Connect with Kairoseth Fiscal.
5. Choose the real fiscal invoice-number source used by the business.
6. Create a controlled test order and run manual Preflight.
7. Enable automatic sending only after the test is successful.
8. Enable corrective/refund automation only after its server-side profile and numbering have been validated.

== Changelog ==

= 0.4.0 =
* Replaced the technical setup screen with a customer-facing Kairoseth Fiscal onboarding flow.
* Added a single scoped connection-key flow for normal WooCommerce customers.
* Hidden bridge URL, MappingProfile IDs and API token fields from the normal setup path.
* Added explicit connection state and simplified invoicing/automatic-send settings.
* Kept technical fields under Advanced settings for support and custom integrations.
* Added a server-side-safe connection-key generator that reads the scoped token from stdin instead of process arguments.

= 0.3.0 =
* Added vendor-neutral VERI*FACTU invoice presentation metadata.
* Added HPOS-safe persistence for QR/text presentation data.
* Added public helper/filter/action integration points for any invoice renderer.
* No dependency on a specific WooCommerce PDF plugin.

= 0.2.0 =
* Added explicit WooCommerce refunds/corrective-operation flow.
* Added HPOS/legacy traffic-light status column.
* Added separate corrective MappingProfile and refund numbering configuration.
* Added sync-error degradation from green to amber.
* Added reproducible release packaging and compatibility validation metadata.

= 0.1.0 =
* Initial HPOS-safe WooCommerce connector foundation.
