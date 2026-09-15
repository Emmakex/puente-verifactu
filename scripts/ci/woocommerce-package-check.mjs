import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildWooCommerceZip } from '../release/package-woocommerce.mjs';

function listLocalEntries(buffer) {
  const names = [];
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    names.push(name);
    offset = nameStart + nameLength + extraLength + compressedSize;
  }
  return names;
}

const first = await buildWooCommerceZip();
const second = await buildWooCommerceZip();
assert.equal(first.version, '0.2.0');
assert.deepEqual(first.buffer, second.buffer, 'WooCommerce ZIP must be byte-for-byte reproducible');

const names = listLocalEntries(first.buffer);
assert.deepEqual(names, first.entries.map((entry) => entry.name));
assert.ok(names.includes('puente-verifactu-woocommerce/puente-verifactu-woocommerce.php'));
assert.ok(names.includes('puente-verifactu-woocommerce/readme.txt'));
assert.ok(names.includes('puente-verifactu-woocommerce/README.md'));
assert.ok(names.includes('puente-verifactu-woocommerce/includes/class-pv-woo-connector.php'));
assert.ok(names.includes('puente-verifactu-woocommerce/includes/class-pv-woo-refund-payload.php'));
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
  sha256: createHash('sha256').update(first.buffer).digest('hex'),
}, null, 2));
