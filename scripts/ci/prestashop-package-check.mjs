import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildPrestaShopZip } from '../release/package-prestashop.mjs';

function listLocalEntries(buffer) {
  const names = [];
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    names.push(buffer.subarray(nameStart, nameStart + nameLength).toString('utf8'));
    offset = nameStart + nameLength + extraLength + compressedSize;
  }
  return names;
}

const first = await buildPrestaShopZip();
const second = await buildPrestaShopZip();
assert.equal(first.version, '0.3.0');
assert.deepEqual(first.buffer, second.buffer, 'PrestaShop ZIP must be byte-for-byte reproducible');

const names = listLocalEntries(first.buffer);
assert.deepEqual(names, first.entries.map((entry) => entry.name));
assert.equal(names[0], 'puenteverifactu/', 'Legacy PrestaShop installers require the module root directory as the first ZIP entry');
assert.ok(names.includes('puenteverifactu/classes/'));
assert.ok(names.includes('puenteverifactu/upgrade/'));
assert.ok(names.includes('puenteverifactu/puenteverifactu.php'));
assert.ok(names.includes('puenteverifactu/README.md'));
assert.ok(names.includes('puenteverifactu/classes/PVFPrestaShopClient.php'));
assert.ok(names.includes('puenteverifactu/classes/PVFPrestaShopOrderPayload.php'));
assert.ok(names.includes('puenteverifactu/classes/PVFPrestaShopOrderSlipPayload.php'));
assert.ok(names.includes('puenteverifactu/classes/PVFPrestaShopRectifications.php'));
assert.ok(names.includes('puenteverifactu/classes/PVFPrestaShopTaxBreakdown.php'));
assert.ok(names.includes('puenteverifactu/classes/PVFPrestaShopSecretStore.php'));
assert.ok(names.includes('puenteverifactu/classes/PVFPrestaShopAdminStatus.php'));
assert.ok(names.includes('puenteverifactu/upgrade/install-0.1.0.php'));
assert.ok(names.includes('puenteverifactu/upgrade/install-0.2.0.php'));
assert.ok(names.includes('puenteverifactu/upgrade/install-0.3.0.php'));
assert.equal(names.some((name) => name.includes('/examples/')), false, 'Server-side mapping examples must not ship in the PrestaShop runtime ZIP');
assert.equal(names.some((name) => name.includes('/fixtures/')), false, 'Fiscal test fixtures must not ship in the PrestaShop runtime ZIP');
assert.equal(names.some((name) => name.includes('/scripts/')), false);
assert.equal(names.some((name) => name.includes('../')), false);

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'prestashop-release-package',
  version: first.version,
  entries: names.length,
  corrective_credit_slips: true,
  sha256: createHash('sha256').update(first.buffer).digest('hex'),
}, null, 2));
