import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const issuerPath = 'scripts/ops/woocommerce-activation-issuer.mjs';
const testPath = 'scripts/ops/test/woocommerce-activation-issuer.test.mjs';
const docsPath = 'docs/woocommerce-customer-activation.md';

const issuer = readFileSync(issuerPath, 'utf8');
const test = readFileSync(testPath, 'utf8');
const docs = readFileSync(docsPath, 'utf8');

for (const marker of [
  "nativeConnector: 'woocommerce'",
  '/materialize-integration',
  '/mapping',
  '/credential',
  'prepareWooCommerceMapping',
  'buildWooCommerceConnectionKey',
  'KFS1.',
  'stdin.isTTY',
  'credentialShownOnce',
]) {
  assert.ok(issuer.includes(marker), `WooCommerce activation issuer missing ${marker}`);
}

assert.equal(/--(?:admin-)?token\b/i.test(issuer), false, 'Admin token must never be accepted as a process argument');
assert.ok(issuer.includes('PLACEHOLDER_RE'), 'Fiscal mapping placeholders must fail closed');
assert.ok(test.includes('admin token'), 'Activation security regression test is required');
assert.ok(docs.includes('ningún secreto administrativo en WordPress'), 'Customer activation authority must be documented');

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'woocommerce-customer-activation-issuer',
}, null, 2));
