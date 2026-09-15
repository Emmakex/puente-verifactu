import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrestaShopZip } from './package-prestashop.mjs';
import { buildWooCommerceZip } from './package-woocommerce.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizeCommit(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error('Release evidence requires an explicit 40-character source commit SHA');
  }
  return value.toLowerCase();
}

function normalizeGeneratedAt(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error('Invalid generatedAt value');
  return date.toISOString();
}

function validateReleaseGateConfig(config) {
  if (config?.schema_version !== 1) throw new Error('Unsupported release gate schema');
  if (!['release_blocked', 'release_candidate'].includes(config.release_status)) throw new Error('Invalid release_status');
  if (!Array.isArray(config.blockers) || !Array.isArray(config.profile_decisions)) throw new Error('Invalid release gate configuration');
}

function validateRegulatoryRegistry(registry) {
  if (registry?.schema_version !== 1) throw new Error('Unsupported regulatory source schema');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(registry.reviewed_at ?? '')) throw new Error('Invalid regulatory reviewed_at');
  if (!Number.isInteger(registry.expires_after_days) || registry.expires_after_days < 1) throw new Error('Invalid regulatory expiry');
  if (!Array.isArray(registry.sources) || registry.sources.length < 3) throw new Error('Regulatory registry requires official sources');
}

export async function buildReleaseEvidence({ commit, generatedAt = null, ci = null } = {}) {
  const [packageJson, releaseGates, regulatorySources, woo, prestashop] = await Promise.all([
    readJson(join(REPO_ROOT, 'package.json')),
    readJson(join(REPO_ROOT, 'config/release-gates.json')),
    readJson(join(REPO_ROOT, 'config/regulatory-sources.json')),
    buildWooCommerceZip(),
    buildPrestaShopZip(),
  ]);

  validateReleaseGateConfig(releaseGates);
  validateRegulatoryRegistry(regulatorySources);

  const openBlockers = releaseGates.blockers.filter((blocker) => blocker.status !== 'closed');
  const computedStatus = openBlockers.length > 0 ? 'release_blocked' : 'release_candidate';
  if (releaseGates.release_status !== computedStatus) {
    throw new Error(`release_status must be ${computedStatus} for the current blockers`);
  }

  return {
    schema_version: 1,
    evidence_kind: 'puente-verifactu-release-evidence',
    generated_at: normalizeGeneratedAt(generatedAt),
    source: {
      repository: 'Emmakex/puente-verifactu',
      commit: normalizeCommit(commit),
    },
    product: {
      name: packageJson.name,
      version: packageJson.version,
      deployment_profile: releaseGates.deployment_profile,
    },
    release: {
      status: computedStatus,
      blockers: openBlockers.map(({ id, type, status, github_issue, required_before, evidence_document }) => ({
        id,
        type,
        status,
        github_issue,
        required_before,
        evidence_document,
      })),
      profile_decisions: releaseGates.profile_decisions,
    },
    artifacts: [
      {
        id: 'woocommerce-connector',
        filename: `puente-verifactu-woocommerce-${woo.version}.zip`,
        version: woo.version,
        files: woo.entries.length,
        sha256: sha256(woo.buffer),
      },
      {
        id: 'prestashop-connector',
        filename: `puenteverifactu-${prestashop.version}.zip`,
        version: prestashop.version,
        files: prestashop.entries.filter((entry) => !entry.isDirectory).length,
        sha256: sha256(prestashop.buffer),
      },
    ],
    regulatory_review: {
      reviewed_at: regulatorySources.reviewed_at,
      expires_after_days: regulatorySources.expires_after_days,
      aeat_artifacts: regulatorySources.aeat_artifacts,
      sources: regulatorySources.sources,
    },
    responsible_declaration: {
      status: 'required_before_publication',
      template: 'docs/release/declaracion-responsable-template.md',
    },
    ci: {
      workflow: ci?.workflow ?? null,
      run_id: ci?.run_id ?? null,
      run_number: ci?.run_number ?? null,
      result: ci?.result ?? null,
    },
  };
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commit = argValue('--commit');
  const evidence = await buildReleaseEvidence({
    commit,
    generatedAt: argValue('--generated-at'),
    ci: {
      workflow: argValue('--ci-workflow'),
      run_id: argValue('--ci-run-id'),
      run_number: argValue('--ci-run-number'),
      result: argValue('--ci-result'),
    },
  });

  const expected = argValue('--expect');
  if (expected && evidence.release.status !== expected) {
    throw new Error(`Expected release status ${expected}, got ${evidence.release.status}`);
  }

  const output = argValue('--output');
  if (output) {
    const target = resolve(output);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  }

  console.log(JSON.stringify(evidence, null, 2));
}
