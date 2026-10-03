import { readFileSync } from 'node:fs';
import { DEFAULT_NATIVE_CONNECTORS } from '../../packages/kairoseth-control-plane/src/capability-onboarding.mjs';

const product = JSON.parse(readFileSync('config/kairoseth-extension.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const adapter = JSON.parse(readFileSync('connectors/reference/adapter-manifest.json', 'utf8'));
const localAgent = JSON.parse(readFileSync('packages/local-agent/adapter-manifest.json', 'utf8'));

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
expect(product.infrastructure?.control_plane === 'kairoseth', 'KAIROSETH_CONTROL_PLANE_INVALID');
expect(product.infrastructure?.fiscal_authority === 'server-side', 'KAIROSETH_FISCAL_AUTHORITY_INVALID');
expect(product.infrastructure?.tenant_authority === 'server-side', 'KAIROSETH_TENANT_AUTHORITY_INVALID');
expect(product.infrastructure?.certificate_custody === 'server-side', 'KAIROSETH_CERTIFICATE_CUSTODY_INVALID');
expect(product.infrastructure?.local_agent_role === 'edge-connector', 'KAIROSETH_LOCAL_AGENT_ROLE_INVALID');
expect(product.infrastructure?.local_agent_inbound_ports === false, 'KAIROSETH_LOCAL_AGENT_INBOUND_PORTS_FORBIDDEN');
expect(product.infrastructure?.local_agent_direct_aeat_authority === false, 'KAIROSETH_LOCAL_AGENT_DIRECT_AEAT_FORBIDDEN');
expect(product.technical_identity?.name === 'Puente VeriFactu', 'KAIROSETH_TECHNICAL_NAME_INVALID');
expect(product.technical_identity?.slug === 'puente-verifactu', 'KAIROSETH_TECHNICAL_SLUG_INVALID');
expect(product.commercial_facade?.enabled === true, 'KAIROSETH_COMMERCIAL_FACADE_DISABLED');
expect(product.commercial_facade?.pattern_reference === 'Puente DeCA -> Kairoseth Cargo', 'KAIROSETH_COMMERCIAL_PATTERN_INVALID');
expect(product.commercial_facade?.canonical_route_template === '/products/{commercial_slug}', 'KAIROSETH_COMMERCIAL_ROUTE_PATTERN_INVALID');
expect(product.commercial_facade?.technical_route === '/products/puente-verifactu', 'KAIROSETH_TECHNICAL_ROUTE_INVALID');
expect(Array.isArray(product.commercial_facade?.commercial_families)
  && ['web', 'connect', 'api'].every((id) => product.commercial_facade.commercial_families.includes(id)),
  'KAIROSETH_COMMERCIAL_FAMILIES_INVALID');
expect(Array.isArray(product.channels) && product.channels.includes('native_plugin'), 'KAIROSETH_NATIVE_CHANNEL_MISSING');
expect(Array.isArray(product.channels) && product.channels.includes('rest_api'), 'KAIROSETH_API_CHANNEL_MISSING');
expect(Array.isArray(product.channels) && product.channels.includes('file_upload'), 'KAIROSETH_FILE_CHANNEL_MISSING');
expect(Array.isArray(product.native_connectors)
  && product.native_connectors.includes('woocommerce')
  && product.native_connectors.includes('prestashop'), 'KAIROSETH_NATIVE_CONNECTORS_MISSING');
expect(
  JSON.stringify([...product.native_connectors].sort()) === JSON.stringify([...DEFAULT_NATIVE_CONNECTORS].sort()),
  'KAIROSETH_ONBOARDING_NATIVE_CONNECTORS_DRIFT'
);

expect(adapter.product?.ecosystem === 'kairoseth', 'ADAPTER_PRODUCT_ECOSYSTEM_MISSING');
expect(adapter.product?.catalog === 'extensions', 'ADAPTER_PRODUCT_CATALOG_MISSING');
expect(adapter.product?.product_id === product.product_id, 'ADAPTER_PRODUCT_BINDING_MISMATCH');

expect(localAgent.product?.ecosystem === 'kairoseth', 'LOCAL_AGENT_KAIROSETH_ECOSYSTEM_MISSING');
expect(localAgent.product?.catalog === 'extensions', 'LOCAL_AGENT_KAIROSETH_CATALOG_MISSING');
expect(localAgent.product?.product_id === product.product_id, 'LOCAL_AGENT_PRODUCT_BINDING_MISMATCH');
expect(localAgent.mapping === 'server-side', 'LOCAL_AGENT_SERVER_MAPPING_REQUIRED');
expect(localAgent.security?.control_plane === 'kairoseth', 'LOCAL_AGENT_CONTROL_PLANE_INVALID');
expect(localAgent.security?.secrets_server_side === true, 'LOCAL_AGENT_SERVER_SECRETS_REQUIRED');
expect(localAgent.security?.aeat_certificate_server_side === true, 'LOCAL_AGENT_SERVER_CERTIFICATE_REQUIRED');
expect(localAgent.security?.tenant_server_authoritative === true, 'LOCAL_AGENT_SERVER_TENANT_AUTHORITY_REQUIRED');
expect(localAgent.security?.local_agent_role === 'edge-connector', 'LOCAL_AGENT_EDGE_ROLE_REQUIRED');
expect(localAgent.security?.inbound_listener === false, 'LOCAL_AGENT_INBOUND_LISTENER_FORBIDDEN');
expect(localAgent.security?.direct_aeat_authority === false, 'LOCAL_AGENT_DIRECT_AEAT_AUTHORITY_FORBIDDEN');

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
  commercial_facade: product.commercial_facade.status,
  commercial_pattern: product.commercial_facade.pattern_reference,
  infrastructure: 'kairoseth-control-plane',
  local_agent_role: 'edge-connector',
}, null, 2));

expect(product.infrastructure?.hosting_provider === 'hostinger', 'KAIROSETH_HOSTINGER_REQUIRED');
expect(product.infrastructure?.primary_database === 'mongodb', 'KAIROSETH_MONGODB_REQUIRED');
expect(product.infrastructure?.control_plane_persistence === 'mongodb', 'KAIROSETH_MONGODB_CONTROL_PLANE_REQUIRED');
expect(product.infrastructure?.local_agent_registry === 'mongodb-injected', 'KAIROSETH_MONGODB_AGENT_REGISTRY_REQUIRED');
