import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ZIP_ROOT = 'kairoseth-local-agent';
const NODE_REQUIREMENT = '>=22.13.0';
const UPGRADE_NODE_REQUIREMENT = '>=22.16.0';

export const LOCAL_AGENT_RUNTIME_DEPENDENCIES = Object.freeze({
  pg: '8.23.1',
  mysql2: '3.24.5',
  mssql: '11.0.2',
  'ssh2-sftp-client': '12.1.1',
});

const SOURCE_ROOTS = Object.freeze([
  'packages/local-agent/src',
  'packages/core/src',
  'packages/sdk/src',
  'packages/contracts/src',
  'connectors/file-import/src',
]);

const SOURCE_FILES = Object.freeze([
  'packages/local-agent/README.md',
  'packages/local-agent/adapter-manifest.json',
  'config/local-agent.example.json',
  'config/local-agent.env.example',
  'packages/local-agent/service/linux/kairoseth-local-agent.service.template',
  'packages/local-agent/service/linux/install.sh',
  'packages/local-agent/service/linux/uninstall.sh',
  'packages/local-agent/service/linux/upgrade.sh',
  'packages/local-agent/service/linux/rollback.sh',
  'packages/local-agent/service/macos/run.sh.template',
  'packages/local-agent/service/macos/com.kairoseth.local-agent.plist.template',
  'packages/local-agent/service/macos/install.sh',
  'packages/local-agent/service/macos/uninstall.sh',
  'packages/local-agent/service/macos/upgrade.sh',
  'packages/local-agent/service/macos/rollback.sh',
  'packages/local-agent/service/windows/run.ps1',
  'packages/local-agent/service/windows/install.ps1',
  'packages/local-agent/service/windows/uninstall.ps1',
  'packages/local-agent/service/windows/upgrade.ps1',
  'packages/local-agent/service/windows/rollback.ps1',
]);

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

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function assertCommit(value) {
  const commit = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw Object.assign(new Error('A full 40-character source commit is required'), {
      code: 'VF_LOCAL_AGENT_PACKAGE_COMMIT_REQUIRED',
    });
  }
  return commit;
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

function json(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function bootstrapSource() {
  return Buffer.from(`#!/usr/bin/env node
const minimum = [22, 13, 0];
const current = process.versions.node.split('.').map(Number);
const supported = current[0] > minimum[0]
  || (current[0] === minimum[0] && current[1] > minimum[1])
  || (current[0] === minimum[0] && current[1] === minimum[1] && current[2] >= minimum[2]);

if (!supported) {
  process.stderr.write(JSON.stringify({
    schemaVersion: 1,
    status: 'error',
    error: {
      code: 'VF_LOCAL_AGENT_NODE_UNSUPPORTED',
      message: 'Kairoseth Local Agent requires Node.js >=22.13.0',
      current: process.versions.node,
    },
  }) + '\\n');
  process.exit(1);
}

await import('../packages/local-agent/src/cli.mjs');
`, 'utf8');
}

function bundleReadme(version) {
  return Buffer.from(`# Kairoseth Local Agent ${version}

Portable source bundle for Kairoseth Fiscal / Puente VeriFactu.

Requirements:
- Node.js >= 22.13.0.
- Run \`npm install --omit=dev --ignore-scripts\` once after extraction.
- Copy \`config/local-agent.example.json\` outside the application directory and keep the real config private.
- Keep secrets in environment variables referenced by the config. Never put AEAT certificates or private keys in the Local Agent.

Commands:
- \`node bin/kairoseth-local-agent.mjs doctor --config <path>\`
- \`node bin/kairoseth-local-agent.mjs status --config <path>\`
- \`node bin/kairoseth-local-agent.mjs once --config <path>\`
- \`node bin/kairoseth-local-agent.mjs start --config <path>\`

The bundle is architecture-neutral JavaScript. Platform support is claimed only where the exact bundle passes the repository's native OS smoke tests.
`, 'utf8');
}

function fileMode(name) {
  return name === `${ZIP_ROOT}/bin/kairoseth-local-agent.mjs` ? 0o100755 : 0o100644;
}

export function createStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosDate = 0x0021;

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
    central.writeUInt32LE((fileMode(entry.name) << 16) >>> 0, 38);
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

async function sourceEntries() {
  const entries = [];
  for (const root of SOURCE_ROOTS) {
    for (const path of await walk(join(REPO_ROOT, root))) {
      const rel = relative(REPO_ROOT, path).replaceAll('\\', '/');
      if (!rel.endsWith('.mjs')) continue;
      entries.push({ name: `${ZIP_ROOT}/${rel}`, data: await readFile(path) });
    }
  }
  for (const rel of SOURCE_FILES) {
    entries.push({ name: `${ZIP_ROOT}/${rel}`, data: await readFile(join(REPO_ROOT, rel)) });
  }
  return entries;
}

export async function buildLocalAgentPortableZip({ sourceCommit } = {}) {
  const commit = assertCommit(sourceCommit);
  const rootPackage = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));
  const version = String(rootPackage.version);

  const packageJson = {
    name: '@kairoseth/local-agent',
    version,
    private: true,
    description: 'Portable Kairoseth Fiscal / Puente VeriFactu Local Agent',
    type: 'module',
    engines: { node: NODE_REQUIREMENT },
    bin: { 'kairoseth-local-agent': 'bin/kairoseth-local-agent.mjs' },
    scripts: { agent: 'node bin/kairoseth-local-agent.mjs' },
    dependencies: LOCAL_AGENT_RUNTIME_DEPENDENCIES,
  };

  const contentEntries = [
    ...await sourceEntries(),
    { name: `${ZIP_ROOT}/package.json`, data: json(packageJson) },
    { name: `${ZIP_ROOT}/bin/kairoseth-local-agent.mjs`, data: bootstrapSource() },
    { name: `${ZIP_ROOT}/BUNDLE-README.md`, data: bundleReadme(version) },
  ];
  contentEntries.sort((a, b) => a.name.localeCompare(b.name));

  const files = contentEntries.map((entry) => Object.freeze({
    path: entry.name.slice(`${ZIP_ROOT}/`.length),
    bytes: entry.data.length,
    sha256: sha256(entry.data),
  }));
  const contentFingerprint = sha256(Buffer.from(
    files.map((file) => `${file.sha256}  ${file.path}\n`).join(''),
    'utf8',
  ));

  const manifest = Object.freeze({
    schemaVersion: 1,
    product: 'kairoseth-fiscal',
    component: 'local-agent',
    artifactKind: 'portable-source',
    version,
    sourceCommit: commit,
    requiredNode: NODE_REQUIREMENT,
    upgradeRequiredNode: UPGRADE_NODE_REQUIREMENT,
    stateCompatibility: Object.freeze({
      current: 1,
      minReadable: 1,
      maxReadable: 1,
      backupRequired: true,
      automaticDatabaseRollback: false,
    }),
    runtimeDependencies: LOCAL_AGENT_RUNTIME_DEPENDENCIES,
    architecture: 'any-node22',
    contentFingerprint,
    files,
  });

  const entries = [
    ...contentEntries,
    { name: `${ZIP_ROOT}/bundle-manifest.json`, data: json(manifest) },
  ].sort((a, b) => a.name.localeCompare(b.name));

  const buffer = createStoredZip(entries);
  return Object.freeze({
    version,
    sourceCommit: commit,
    entries: Object.freeze(entries.map((entry) => Object.freeze({
      name: entry.name,
      data: Buffer.from(entry.data),
    }))),
    manifest,
    buffer,
    sha256: sha256(buffer),
  });
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceCommit = argValue('--source-commit') || process.env.PV_SOURCE_COMMIT;
  const bundle = await buildLocalAgentPortableZip({ sourceCommit });
  const output = resolve(
    argValue('--output') || join(REPO_ROOT, 'dist', `kairoseth-local-agent-${bundle.version}.zip`),
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bundle.buffer);
  await writeFile(`${output}.sha256`, `${bundle.sha256}  ${output.split(/[\\/]/).at(-1)}\n`, 'utf8');

  console.log(JSON.stringify({
    schema_version: 1,
    status: 'ok',
    artifact: output,
    version: bundle.version,
    source_commit: bundle.sourceCommit,
    files: bundle.entries.length,
    content_fingerprint: bundle.manifest.contentFingerprint,
    sha256: bundle.sha256,
  }, null, 2));
}
