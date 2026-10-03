import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function phpFiles(root) {
  const files = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) files.push(...phpFiles(path));
    else if (path.endsWith('.php')) files.push(path);
  }
  return files;
}

const failures = [];
const prestaFiles = phpFiles('connectors/prestashop');
const wooFiles = phpFiles('connectors/woocommerce');

for (const path of prestaFiles) {
  const source = readFileSync(path, 'utf8');
  if (/version_compare\s*\(\s*_PS_VERSION_/i.test(source)) {
    failures.push({ code: 'PRESTA_RUNTIME_VERSION_BRANCH_FORBIDDEN', path });
  }
}

for (const path of wooFiles) {
  const source = readFileSync(path, 'utf8');
  if (/version_compare\s*\(\s*(?:WC_VERSION|defined\s*\(\s*['"]WC_VERSION)/i.test(source)) {
    failures.push({ code: 'WOO_RUNTIME_VERSION_BRANCH_FORBIDDEN', path });
  }
  if (/wpo[_-]wcpdf|yith[_-].*pdf|woocommerce[_-]pdf[_-]invoices/i.test(source)) {
    failures.push({ code: 'WOO_PDF_VENDOR_DEPENDENCY_FORBIDDEN', path });
  }
}

const prestaCompat = readFileSync('connectors/prestashop/classes/PVFPrestaShopCompatibility.php', 'utf8');
for (const marker of ['Hook::getIdByName', 'registerAvailableHooks', 'presentationCapabilities', 'assertInvoicePresentationReady', 'assertCorrectivePresentationReady']) {
  if (!prestaCompat.includes(marker)) failures.push({ code: 'PRESTA_CAPABILITY_LAYER_INCOMPLETE', marker });
}

const wooPresentation = readFileSync('connectors/woocommerce/includes/class-pv-woo-invoice-presentation.php', 'utf8');
for (const marker of ['pv_woo_get_invoice_presentation', 'META_KEY', 'WC_Abstract_Order']) {
  if (!wooPresentation.includes(marker)) failures.push({ code: 'WOO_NEUTRAL_PRESENTATION_API_INCOMPLETE', marker });
}

const wooConnector = readFileSync('connectors/woocommerce/includes/class-pv-woo-connector.php', 'utf8');
if (!wooConnector.includes("add_filter( 'pv_woo_invoice_presentation'")) {
  failures.push({ code: 'WOO_PRESENTATION_FILTER_MISSING' });
}
if (!wooConnector.includes("do_action( 'pv_woo_invoice_presentation_updated'")) {
  failures.push({ code: 'WOO_PRESENTATION_ACTION_MISSING' });
}

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    check: 'connector-version-neutrality',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'connector-version-neutrality',
  strategy: 'capability-first',
  prestashop_version_branching: false,
  woocommerce_version_branching: false,
  woocommerce_pdf_vendor_dependency: false,
}, null, 2));
