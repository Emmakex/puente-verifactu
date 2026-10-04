import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function argValue(flag, argv = process.argv) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
}

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) {
    const error = new Error(`Missing required argument: ${name}`);
    error.code = 'VF_FINAL_RELEASE_ARGUMENT_REQUIRED';
    throw error;
  }
  return text;
}

const PRODUCTIVE_DEPLOYMENT_PROFILE = 'kairoseth-hostinger-mongodb';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function assertSha40(value, name) {
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    const error = new Error(`${name} must be a 40-character commit SHA`);
    error.code = 'VF_FINAL_RELEASE_COMMIT_INVALID';
    throw error;
  }
  return value.toLowerCase();
}

function ensureArtifacts(artifacts) {
  const requiredIds = new Set([
    'woocommerce-connector',
    'prestashop-connector',
    'kairoseth-local-agent',
  ]);
  if (!Array.isArray(artifacts)) {
    const error = new Error('Release evidence artifacts are missing');
    error.code = 'VF_FINAL_RELEASE_ARTIFACTS_INVALID';
    throw error;
  }
  const seen = new Set();
  for (const artifact of artifacts) {
    const id = String(artifact?.id ?? '').trim();
    const hash = String(artifact?.sha256 ?? '').trim().toLowerCase();
    if (!id || seen.has(id) || !/^[0-9a-f]{64}$/.test(hash)) {
      const error = new Error('Release evidence contains an invalid or duplicate artifact');
      error.code = 'VF_FINAL_RELEASE_ARTIFACTS_INVALID';
      throw error;
    }
    seen.add(id);
    requiredIds.delete(id);
  }
  if (requiredIds.size > 0) {
    const error = new Error(`Release evidence is missing required artifacts: ${[...requiredIds].join(', ')}`);
    error.code = 'VF_FINAL_RELEASE_ARTIFACTS_MISSING';
    throw error;
  }
}

function ensureDeclaration(content, version) {
  const requiredSections = [...'abcdefghijkl'];
  for (const letter of requiredSections) {
    if (!content.includes(`**${letter}) `)) {
      const error = new Error(`Responsible declaration missing section ${letter})`);
      error.code = 'VF_FINAL_RELEASE_DECLARATION_SECTION_MISSING';
      throw error;
    }
  }

  if (!content.includes(version)) {
    const error = new Error(`Responsible declaration does not reference version ${version}`);
    error.code = 'VF_FINAL_RELEASE_DECLARATION_VERSION_MISMATCH';
    throw error;
  }

  const placeholders = [
    '<NOMBRE', '<NIF>', '<DIRECCION', '<FECHA', '<LOCALIDAD',
    'NOMBRE Y APELLIDOS O RAZÓN SOCIAL', 'DIRECCIÓN POSTAL COMPLETA',
  ];
  if (placeholders.some((placeholder) => content.includes(placeholder))) {
    const error = new Error('Responsible declaration still contains placeholders');
    error.code = 'VF_FINAL_RELEASE_DECLARATION_PLACEHOLDERS';
    throw error;
  }
}

export async function buildFinalReleaseBundle({
  releaseEvidencePath,
  declarationPath,
  expectedCommit,
  outputPath = null,
}) {
  const [releaseBuffer, declarationBuffer] = await Promise.all([
    readFile(resolve(required(releaseEvidencePath, '--release-evidence'))),
    readFile(resolve(required(declarationPath, '--declaration'))),
  ]);

  const release = JSON.parse(releaseBuffer.toString('utf8'));
  const declaration = declarationBuffer.toString('utf8');

  const commit = assertSha40(required(expectedCommit, '--expected-commit'), '--expected-commit');

  if (release?.source?.commit !== commit) {
    const error = new Error('Release evidence commit does not match expected commit');
    error.code = 'VF_FINAL_RELEASE_COMMIT_MISMATCH';
    throw error;
  }
  if (release?.release?.status !== 'release_candidate') {
    const error = new Error('Release evidence is not release_candidate');
    error.code = 'VF_FINAL_RELEASE_STATUS_INVALID';
    throw error;
  }
  if ((release?.release?.blockers ?? []).length !== 0) {
    const error = new Error('Release evidence still contains blockers');
    error.code = 'VF_FINAL_RELEASE_BLOCKERS_OPEN';
    throw error;
  }
  if (release?.ci?.result !== 'success') {
    const error = new Error('Release evidence CI result is not success');
    error.code = 'VF_FINAL_RELEASE_CI_NOT_GREEN';
    throw error;
  }

  const version = required(release?.product?.version, 'release.product.version');
  ensureArtifacts(release?.artifacts);
  if (release?.product?.deployment_profile !== PRODUCTIVE_DEPLOYMENT_PROFILE) {
    const error = new Error(`Release evidence must target ${PRODUCTIVE_DEPLOYMENT_PROFILE}`);
    error.code = 'VF_FINAL_RELEASE_PROFILE_MISMATCH';
    throw error;
  }
  ensureDeclaration(declaration, version);

  const bundle = {
    schema_version: 1,
    evidence_kind: 'puente-verifactu-final-release-bundle',
    status: 'candidate_evidence_complete',
    source_commit: commit,
    product: {
      name: release.product.name,
      version,
      deployment_profile: release.product.deployment_profile,
    },
    ci: {
      workflow: release.ci.workflow,
      run_id: release.ci.run_id,
      run_number: release.ci.run_number,
      result: release.ci.result,
    },
    release: {
      status: release.release.status,
      blockers: 0,
    },
    artifacts: release.artifacts.map(({ id, filename, version: artifactVersion, sha256: artifactSha256 }) => ({
      id,
      filename,
      version: artifactVersion,
      sha256: artifactSha256,
    })),
    declaration: {
      present: true,
      version_bound: true,
      required_sections: 12,
      sha256: sha256(declarationBuffer),
      contains_personal_data: true,
      content_in_bundle: false,
    },
    release_evidence_sha256: sha256(releaseBuffer),
  };

  if (outputPath) {
    const target = resolve(outputPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await chmod(target, 0o600);
  }

  return bundle;
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('finalize-candidate.mjs')) {
  const bundle = await buildFinalReleaseBundle({
    releaseEvidencePath: argValue('--release-evidence'),
    declarationPath: argValue('--declaration'),
    expectedCommit: argValue('--expected-commit'),
    outputPath: argValue('--output'),
  });

  console.log(JSON.stringify(bundle, null, 2));
}
