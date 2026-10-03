import { readFileSync } from 'node:fs';

const product = JSON.parse(readFileSync('config/kairoseth-extension.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const adapter = JSON.parse(readFileSync('connectors/reference/adapter-manifest.json', 'utf8'));

const failures = [];
function expect(condition, code, details = {}) {
  if (!condition) failures.push({ code, ...details });
}

expect(product.schema_version === 1, 'KAIROSETH_EXTENSION_SCHEMA_INVALID');
expect(product.kind === 'kairoseth-extension-product', 'KAIROSETH_EXTENSION_KIND_INVALID');
expect(product.ecosystem === 'kairoseth', 'KAIROSETH_ECOSYSTEM_INVALID');
expect(product.catalog === 'extensions', 'KAIROSETH_CATALOG_INVALID');
expect(product.product_id === 'puente-verifactu', 'KAIROSETH_PRODUCT_ID_INVALID');
expect(product.slug === 'puente-verifactu', 'KAIROSETH_PRODUCT_SLUG_INVALID');
expect(product.name === 'Puente VeriFactu', 'KAIROSETH_PRODUCT_NAME_INVALID');
expect(product.version === pkg.version, 'KAIROSETH_PRODUCT_VERSION_MISMATCH', {
  manifest: product.version,
  package: pkg.version,
});
expect(product.core?.shared === true && product.core?.fiscal_engine === 'single', 'KAIROSETH_SINGLE_CORE_INVARIANT_MISSING');
expect(product.principles?.one_product_many_adapters === true, 'KAIROSETH_ONE_PRODUCT_INVARIANT_MISSING');
expect(product.principles?.adapters_are_not_products === true, 'KAIROSETH_ADAPTER_BOUNDARY_MISSING');
expect(product.principles?.server_side_fiscal_authority === true, 'KAIROSETH_SERVER_AUTHORITY_MISSING');
expect(Array.isArray(product.channels) && product.channels.includes('native_plugin'), 'KAIROSETH_NATIVE_CHANNEL_MISSING');
expect(Array.isArray(product.channels) && product.channels.includes('rest_api'), 'KAIROSETH_API_CHANNEL_MISSING');
expect(Array.isArray(product.channels) && product.channels.includes('file_upload'), 'KAIROSETH_FILE_CHANNEL_MISSING');
expect(Array.isArray(product.native_connectors)
  && product.native_connectors.includes('woocommerce')
  && product.native_connectors.includes('prestashop'), 'KAIROSETH_NATIVE_CONNECTORS_MISSING');

expect(adapter.product?.ecosystem === 'kairoseth', 'ADAPTER_PRODUCT_ECOSYSTEM_MISSING');
expect(adapter.product?.catalog === 'extensions', 'ADAPTER_PRODUCT_CATALOG_MISSING');
expect(adapter.product?.product_id === product.product_id, 'ADAPTER_PRODUCT_BINDING_MISMATCH');

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    check: 'kairoseth-extension-product',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'kairoseth-extension-product',
  ecosystem: product.ecosystem,
  catalog: product.catalog,
  product_id: product.product_id,
  version: product.version,
  model: 'one-product-many-adapters',
}, null, 2));
