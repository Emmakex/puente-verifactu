import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFinalReleaseBundle } from '../release/finalize-candidate.mjs';

const dir = await mkdtemp(join(tmpdir(), 'vf-final-release-'));
const releasePath = join(dir, 'release-evidence.json');
const declarationPath = join(dir, 'declaration.md');
const outputPath = join(dir, 'final-bundle.json');
const commit = '0123456789abcdef0123456789abcdef01234567';

await writeFile(releasePath, JSON.stringify({
  source: { commit },
  product: { name: 'puente-verifactu', version: '0.1.0', deployment_profile: 'sqlite-single-node' },
  release: { status: 'release_candidate', blockers: [] },
  artifacts: [
    { id: 'woocommerce-connector', filename: 'woo.zip', version: '0.2.0', sha256: 'a'.repeat(64) },
    { id: 'prestashop-connector', filename: 'ps.zip', version: '0.4.0', sha256: 'b'.repeat(64) },
  ],
  ci: { workflow: 'CI', run_id: '1', run_number: '1', result: 'success' },
}, null, 2));

const declaration = [
  '# DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN',
  ...[...'abcdefghijkl'].map((letter) => `**${letter}) Campo obligatorio:** valor válido`),
  'Puente VeriFactu versión 0.1.0',
  'Productor Ejemplo',
  '00000000T',
  'Calle Ejemplo 1',
  '3 de octubre de 2026',
].join('\n');

await writeFile(declarationPath, declaration);

const bundle = await buildFinalReleaseBundle({
  releaseEvidencePath: releasePath,
  declarationPath,
  expectedCommit: commit,
  outputPath,
});

assert.equal(bundle.status, 'candidate_evidence_complete');
assert.equal(bundle.source_commit, commit);
assert.equal(bundle.release.status, 'release_candidate');
assert.equal(bundle.release.blockers, 0);
assert.equal(bundle.ci.result, 'success');
assert.equal(bundle.declaration.present, true);
assert.equal(bundle.declaration.version_bound, true);
assert.equal(bundle.declaration.required_sections, 12);
assert.match(bundle.declaration.sha256, /^[0-9a-f]{64}$/);
assert.equal(bundle.declaration.content_in_bundle, false);
assert.match(bundle.release_evidence_sha256, /^[0-9a-f]{64}$/);

const persisted = JSON.parse(await readFile(outputPath, 'utf8'));
assert.deepEqual(persisted, bundle);
assert.equal((await stat(outputPath)).mode & 0o777, 0o600);

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'final-release-bundle-contract',
  output_mode: '0600',
  declaration_content_embedded: false,
}, null, 2));
