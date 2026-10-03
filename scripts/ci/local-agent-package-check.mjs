import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { buildLocalAgentPortableZip, LOCAL_AGENT_RUNTIME_DEPENDENCIES } from '../release/package-local-agent.mjs';

const sourceCommit = process.env.PV_SOURCE_COMMIT || '0123456789abcdef0123456789abcdef01234567';

const first = await buildLocalAgentPortableZip({ sourceCommit });
const second = await buildLocalAgentPortableZip({ sourceCommit });

assert.equal(first.sha256, second.sha256, 'portable bundle must be byte reproducible');
assert.deepEqual(first.buffer, second.buffer, 'portable bundle bytes must be identical');
assert.equal(first.manifest.sourceCommit, sourceCommit.toLowerCase());
assert.equal(first.manifest.requiredNode, '>=22.13.0');
assert.equal(first.manifest.upgradeRequiredNode, '>=22.16.0');
assert.deepEqual(first.manifest.stateCompatibility, {
  current: 1,
  minReadable: 1,
  maxReadable: 1,
  backupRequired: true,
  automaticDatabaseRollback: false,
});
assert.equal(first.manifest.architecture, 'any-node22');
assert.deepEqual(first.manifest.runtimeDependencies, LOCAL_AGENT_RUNTIME_DEPENDENCIES);

const names = first.entries.map((entry) => entry.name);
assert.ok(names.includes('kairoseth-local-agent/bin/kairoseth-local-agent.mjs'));
assert.ok(names.includes('kairoseth-local-agent/packages/local-agent/src/cli.mjs'));
assert.ok(names.includes('kairoseth-local-agent/packages/local-agent/src/runtime.mjs'));
assert.ok(names.includes('kairoseth-local-agent/packages/core/src/idempotency.mjs'));
assert.ok(names.includes('kairoseth-local-agent/packages/sdk/src/client.mjs'));
assert.ok(names.includes('kairoseth-local-agent/packages/contracts/src/constants.mjs'));
assert.ok(names.includes('kairoseth-local-agent/connectors/file-import/src/file-reader.mjs'));
assert.ok(names.includes('kairoseth-local-agent/config/local-agent.example.json'));
assert.ok(names.includes('kairoseth-local-agent/config/local-agent.env.example'));
assert.ok(names.includes('kairoseth-local-agent/packages/local-agent/service/linux/install.sh'));
assert.ok(names.includes('kairoseth-local-agent/packages/local-agent/service/macos/install.sh'));
assert.ok(names.includes('kairoseth-local-agent/packages/local-agent/service/windows/install.ps1'));
assert.ok(names.includes('kairoseth-local-agent/bundle-manifest.json'));

for (const name of names) {
  assert.doesNotMatch(name, /(?:^|\/)test\//);
  assert.doesNotMatch(name, /node_modules/);
  assert.doesNotMatch(name, /(?:\.env|\.pfx|\.p12|\.pem|\.key)$/i);
}

const pkgEntry = first.entries.find((entry) => entry.name.endsWith('/package.json'));
const pkg = JSON.parse(pkgEntry.data.toString('utf8'));
assert.equal(pkg.engines.node, '>=22.13.0');
assert.deepEqual(pkg.dependencies, LOCAL_AGENT_RUNTIME_DEPENDENCIES);
assert.equal(pkg.bin['kairoseth-local-agent'], 'bin/kairoseth-local-agent.mjs');

const bundled = new Set(names);
for (const entry of first.entries.filter((item) => item.name.endsWith('.mjs'))) {
  const source = entry.data.toString('utf8');
  const specifiers = [
    ...source.matchAll(/(?:from\s+|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g),
  ].map((match) => match[2]);

  for (const specifier of specifiers) {
    const resolved = posix.normalize(posix.join(posix.dirname(entry.name), specifier));
    assert.ok(
      bundled.has(resolved),
      `missing bundled relative import: ${entry.name} -> ${specifier} (${resolved})`,
    );
  }
}

const manifestEntry = first.entries.find((entry) => entry.name.endsWith('/bundle-manifest.json'));
assert.deepEqual(JSON.parse(manifestEntry.data.toString('utf8')), first.manifest);

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'local-agent-portable-package',
  version: first.version,
  source_commit: first.sourceCommit,
  files: first.entries.length,
  content_fingerprint: first.manifest.contentFingerprint,
  sha256: first.sha256,
  reproducible: true,
}, null, 2));
