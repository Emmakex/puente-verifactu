import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildWooCommerceZip } from '../release/package-woocommerce.mjs';

function listLocalEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    entries.push({ name, method });
    offset = nameStart + nameLength + extraLength + compressedSize;
  }
  return entries;
}

const first = await buildWooCommerceZip();
const second = await buildWooCommerceZip();
assert.equal(first.version, '0.3.0');
assert.deepEqual(first.buffer, second.buffer, 'WooCommerce ZIP must be byte-for-byte reproducible');

const localEntries = listLocalEntries(first.buffer);
const names = localEntries.map((entry) => entry.name);
assert.deepEqual(names, first.entries.map((entry) => entry.name));
assert.ok(localEntries.every((entry) => entry.method === 8), 'WooCommerce ZIP entries must use DEFLATE to avoid raw PHP in WAF-inspected uploads');
assert.ok(names.includes('puente-verifactu-woocommerce/puente-verifactu-woocommerce.php'));
assert.ok(names.includes('puente-verifactu-woocommerce/readme.txt'));
assert.ok(names.includes('puente-verifactu-woocommerce/README.md'));
assert.ok(names.includes('puente-verifactu-woocommerce/includes/class-pv-woo-connector.php'));
assert.ok(names.includes('puente-verifactu-woocommerce/includes/class-pv-woo-refund-payload.php'));
assert.ok(names.includes('puente-verifactu-woocommerce/includes/class-pv-woo-invoice-presentation.php'));
assert.ok(names.includes('puente-verifactu-woocommerce/languages/puente-verifactu-woocommerce-es_ES.mo'));
assert.equal(names.some((name) => name.includes('/examples/')), false, 'Server-side mapping examples must not ship in the WordPress runtime ZIP');
assert.equal(names.some((name) => name.includes('/scripts/')), false);
assert.equal(names.some((name) => name.includes('../')), false);

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'woocommerce-release-package',
  version: first.version,
  files: names.length,
  compression: 'deflate',
  sha256: createHash('sha256').update(first.buffer).digest('hex'),
}, null, 2));
