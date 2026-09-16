import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AEAT_ARTIFACTS } from '../../packages/aeat-adapter/src/constants.mjs';
import { buildReleaseEvidence } from '../release/release-evidence.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gates = JSON.parse(await readFile(join(REPO_ROOT, 'config/release-gates.json'), 'utf8'));
const registry = JSON.parse(await readFile(join(REPO_ROOT, 'config/regulatory-sources.json'), 'utf8'));

assert.equal(gates.schema_version, 1);
assert.equal(gates.deployment_profile, 'sqlite-single-node');
assert.equal(gates.release_status, 'release_blocked');

const aeatGate = gates.blockers.find((blocker) => blocker.id === 'AEAT_EXTERNAL_GATE_6');
assert.ok(aeatGate, 'AEAT external gate #6 must be represented');
assert.equal(aeatGate.status, 'open');
assert.equal(aeatGate.github_issue, 6);
assert.ok(aeatGate.required_before.includes('release'));
assert.ok(aeatGate.required_before.includes('real_fiscal_pilot'));

const haDecision = gates.profile_decisions.find((decision) => decision.id === 'HA_MULTI_REPLICA');
assert.ok(haDecision, 'HA profile decision must be explicit');
assert.equal(haDecision.status, 'not_applicable');

assert.equal(registry.schema_version, 1);
assert.equal(registry.aeat_artifacts.web_service_document_version, AEAT_ARTIFACTS.webServiceDocumentVersion);
assert.equal(registry.aeat_artifacts.validations_document_version, AEAT_ARTIFACTS.validationsDocumentVersion);
assert.equal(registry.aeat_artifacts.schema_generation, AEAT_ARTIFACTS.schemaGeneration);
assert.equal(registry.aeat_artifacts.record_version, AEAT_ARTIFACTS.recordVersion);

const requiredSources = new Set([
  'aeat_technical_information',
  'aeat_responsible_declaration_faq',
  'aeat_deadlines_2027',
  'boe_rdl_15_2025',
]);
for (const source of registry.sources) {
  requiredSources.delete(source.id);
  assert.ok(['AEAT', 'BOE'].includes(source.authority));
  assert.equal(typeof source.reference, 'string');
  assert.ok(source.reference.length > 10);
}
assert.equal(requiredSources.size, 0, `Missing regulatory sources: ${[...requiredSources].join(', ')}`);

const reviewedAt = Date.parse(`${registry.reviewed_at}T00:00:00Z`);
const artifactsVerifiedAt = Date.parse(`${AEAT_ARTIFACTS.verifiedAt}T00:00:00Z`);
assert.ok(Number.isFinite(reviewedAt));
assert.ok(Number.isFinite(artifactsVerifiedAt));
assert.ok(reviewedAt >= artifactsVerifiedAt, 'Regulatory review cannot predate the pinned AEAT artifact verification');
const ageDays = (Date.now() - reviewedAt) / 86_400_000;
assert.ok(ageDays >= -1, 'Regulatory review date cannot be materially in the future');
assert.ok(ageDays <= registry.expires_after_days, `Regulatory review is stale (${ageDays.toFixed(1)} days)`);

const fixture = {
  commit: '0123456789abcdef0123456789abcdef01234567',
  generatedAt: `${registry.reviewed_at}T12:00:00Z`,
  ci: { workflow: 'CI', run_id: 'fixture', run_number: 'fixture', result: 'success' },
};
const evidence = await buildReleaseEvidence(fixture);
const evidenceAgain = await buildReleaseEvidence(fixture);

assert.equal(evidence.schema_version, 1);
assert.equal(evidence.release.status, 'release_blocked');
assert.equal(evidence.release.blockers.length, 1);
assert.equal(evidence.release.blockers[0].id, 'AEAT_EXTERNAL_GATE_6');
assert.equal(evidence.responsible_declaration.status, 'required_before_publication');
assert.equal(evidence.artifacts.length, 2);
assert.deepEqual(evidence.artifacts, evidenceAgain.artifacts, 'Release artifact fingerprints must be reproducible');
for (const artifact of evidence.artifacts) {
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
  assert.ok(artifact.files > 0);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  release_status: evidence.release.status,
  regulatory_reviewed_at: registry.reviewed_at,
  aeat_artifacts_verified_at: AEAT_ARTIFACTS.verifiedAt,
  regulatory_review_max_age_days: registry.expires_after_days,
  artifacts: evidence.artifacts.map(({ id, version, sha256 }) => ({ id, version, sha256 })),
  blocker: aeatGate.id,
}, null, 2));
