import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN_ROOT = join(REPO_ROOT, 'connectors/woocommerce');
const ZIP_ROOT = 'puente-verifactu-woocommerce';

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function walk(dir) {
  const files = [];
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) files.push(...await walk(path));
    else if (info.isFile()) files.push(path);
  }
  return files;
}

function allowed(relativePath) {
  if (relativePath === 'puente-verifactu-woocommerce.php') return true;
  if (relativePath === 'README.md' || relativePath === 'readme.txt') return true;
  if (relativePath.startsWith('includes/') && relativePath.endsWith('.php')) return true;
  if (relativePath.startsWith('languages/') && /\.(po|mo)$/.test(relativePath)) return true;
  return false;
}

export async function releaseEntries() {
  const paths = await walk(PLUGIN_ROOT);
  const selected = [];
  for (const path of paths) {
    const rel = relative(PLUGIN_ROOT, path).replaceAll('\\', '/');
    if (!allowed(rel)) continue;
    selected.push({
      name: `${ZIP_ROOT}/${rel}`,
      data: await readFile(path),
    });
  }
  selected.sort((a, b) => a.name.localeCompare(b.name));
  return selected;
}

export function createStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosDate = 0x0021; // 1980-01-01 for reproducible archives.

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  }

  const localBuffer = Buffer.concat(locals);
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(localBuffer.length, 16);
  return Buffer.concat([localBuffer, centralBuffer, eocd]);
}

export async function pluginVersion() {
  const source = await readFile(join(PLUGIN_ROOT, 'puente-verifactu-woocommerce.php'), 'utf8');
  const match = source.match(/^\s*\*\s*Version:\s*([^\s]+)\s*$/m);
  if (!match) throw new Error('WooCommerce plugin Version header not found');
  return match[1];
}

export async function buildWooCommerceZip() {
  const entries = await releaseEntries();
  if (entries.length === 0) throw new Error('No WooCommerce release files selected');
  return { entries, buffer: createStoredZip(entries), version: await pluginVersion() };
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entries, buffer, version } = await buildWooCommerceZip();
  const output = resolve(argValue('--output') || join(REPO_ROOT, 'dist', `puente-verifactu-woocommerce-${version}.zip`));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, buffer);
  console.log(JSON.stringify({
    schema_version: 1,
    status: 'ok',
    artifact: output,
    version,
    files: entries.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  }, null, 2));
}
