import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildResponsibleDeclaration } from '../release/responsible-declaration.mjs';

const dir = await mkdtemp(join(tmpdir(), 'vf-declaration-'));
const output = join(dir, 'declaracion.md');

const result = await buildResponsibleDeclaration({
  producerConfig: {
    producer: {
      name: 'Persona Productora Ejemplo',
      taxId: '00000000T',
      postalAddress: 'Calle Ejemplo 1, 00000 Localidad, España',
      otherContact: 'contacto@example.invalid',
      website: 'https://example.invalid',
    },
    signature: {
      place: 'Localidad, España',
      date: '2026-10-03',
    },
  },
  packageJson: { version: '0.1.0' },
  releaseGates: { deployment_profile: 'kairoseth-hostinger-mongodb' },
  outputPath: output,
});

assert.equal(result.status, 'written');
assert.equal(result.system_code, 'PV');
assert.equal(result.version, '0.1.0');
assert.equal(result.deployment_profile, 'kairoseth-hostinger-mongodb');
assert.equal(result.repository_output, false);

const content = await readFile(output, 'utf8');
assert.match(content, /^# DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN/m);
for (const letter of 'abcdefghijkl') {
  assert.match(content, new RegExp(`\\*\\*${letter}\\) `), `Missing declaration section ${letter})`);
}
assert.match(content, /Puente VeriFactu/);
assert.match(content, /0\.1\.0/);
assert.match(content, /Kairoseth/);
assert.match(content, /Hostinger/);
assert.match(content, /MongoDB/);
assert.match(content, /Local Agent/);
assert.match(content, /captura manual/i);
assert.doesNotMatch(content, /SQLite single-node/i);
assert.match(content, /S - Sí\./);
assert.match(content, /Persona Productora Ejemplo/);
assert.match(content, /00000000T/);
assert.match(content, /3 de octubre de 2026/);

await assert.rejects(
  () => buildResponsibleDeclaration({
    producerConfig: {
      producer: {
        name: 'Persona Productora Ejemplo',
        taxId: '00000000T',
        postalAddress: 'Calle Ejemplo 1, 00000 Localidad, España',
      },
      signature: {
        place: 'Localidad, España',
        date: '2026-10-03',
      },
    },
    packageJson: { version: '0.1.0' },
    releaseGates: { deployment_profile: 'sqlite-single-node' },
    outputPath: join(dir, 'declaracion-invalid.md'),
  }),
  (error) => error.code === 'VF_RESPONSIBLE_DECLARATION_PROFILE_INVALID',
);

const mode = (await stat(output)).mode & 0o777;
assert.equal(mode, 0o600);

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'responsible-declaration-contract',
  system_code: 'PV',
  private_output_mode: '0600',
  mandatory_sections: 12,
}, null, 2));
