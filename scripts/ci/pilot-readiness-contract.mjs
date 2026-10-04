import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPilotReadiness } from '../release/pilot-readiness.mjs';

const dir = await mkdtemp(join(tmpdir(), 'pv-pilot-readiness-'));
const commit = '0123456789abcdef0123456789abcdef01234567';
const declarationSha = 'a'.repeat(64);
const releaseEvidenceSha = 'b'.repeat(64);
const backupSha = 'c'.repeat(64);

const bundlePath = join(dir, 'bundle.json');
const approvalPath = join(dir, 'approval.json');
const opsPath = join(dir, 'ops.json');
const backupPath = join(dir, 'backup.json');
const policyPath = join(dir, 'policy.json');
const outputPath = join(dir, 'receipt.json');

await writeFile(bundlePath, JSON.stringify({
  schema_version: 1,
  evidence_kind: 'puente-verifactu-final-release-bundle',
  status: 'candidate_evidence_complete',
  source_commit: commit,
  product: { name: 'puente-verifactu', version: '0.1.0', deployment_profile: 'kairoseth-hostinger-mongodb' },
  ci: { run_id: '10', run_number: '11', result: 'success' },
  release: { status: 'release_candidate', blockers: 0 },
  declaration: { present: true, version_bound: true, sha256: declarationSha, content_in_bundle: false },
  release_evidence_sha256: releaseEvidenceSha,
}, null, 2));

await writeFile(approvalPath, JSON.stringify({
  schema_version: 1,
  kind: 'puente-verifactu-pilot-approval',
  candidate_commit: commit,
  deployment_profile: 'kairoseth-hostinger-mongodb',
  declaration_sha256: declarationSha,
  declaration_approved: true,
  pilot_approved: true,
  approved_at: '2026-10-03T12:00:00Z',
}, null, 2));

await writeFile(opsPath, JSON.stringify({
  schemaVersion: 1,
  mode: 'kairoseth-mongodb',
  database: { ok: true },
  aeatOutbox: {
    available: true,
    reconciliationRequired: 0,
    blocked: 0,
    expiredProcessing: 0,
  },
  backup: { configured: true, status: 'ok' },
  summary: { status: 'ok', critical: 0, warning: 0 },
}, null, 2));

await writeFile(backupPath, JSON.stringify({
  schemaVersion: 1,
  kind: 'kairoseth-managed-backup-readiness',
  deploymentProfile: 'kairoseth-hostinger-mongodb',
  status: 'ok',
  provider: 'fixture-managed-backup',
  containsSecrets: false,
  containsFiscalData: false,
  newestBackup: {
    createdAt: '2026-10-03T11:00:00Z',
    sha256: backupSha,
    remote: true,
    encryptedAtRest: true,
  },
  restoreDrill: {
    performedAt: '2026-10-03T11:30:00Z',
    backupSha256: backupSha,
    result: 'ok',
  },
}, null, 2));

await writeFile(policyPath, JSON.stringify({
  schema_version: 1,
  kind: 'puente-verifactu-pilot-policy',
  deployment_profile: 'kairoseth-hostinger-mongodb',
  max_operations: 5,
  max_duration_minutes: 120,
  max_backup_age_hours: 26,
  max_restore_drill_age_days: 90,
  stop_on_warning: true,
  stop_on_rejection: true,
  stop_on_reconciliation_required: true,
  stop_on_blocked: true,
  require_verified_backup: true,
  rollback_mode: 'code-first-no-automatic-db-restore',
}, null, 2));

const receipt = await buildPilotReadiness({
  bundlePath,
  approvalPath,
  opsStatusPath: opsPath,
  backupReportPath: backupPath,
  policyPath,
  expectedCommit: commit,
  outputPath,
  generatedAt: '2026-10-03T12:30:00Z',
});

assert.equal(receipt.status, 'pilot_ready');
assert.equal(receipt.source_commit, commit);
assert.equal(receipt.declaration.approved, true);
assert.equal(receipt.declaration.sha256, declarationSha);
assert.equal(receipt.operational_readiness.persistence_mode, 'kairoseth-mongodb');
assert.equal(receipt.operational_readiness.ops_status, 'ok');
assert.equal(receipt.operational_readiness.reconciliation_required, 0);
assert.equal(receipt.operational_readiness.blocked, 0);
assert.equal(receipt.operational_readiness.backup_sha256, backupSha);
assert.equal(receipt.pilot_policy.max_operations, 5);
assert.equal(receipt.pilot_policy.max_backup_age_hours, 26);
assert.equal(receipt.pilot_policy.max_restore_drill_age_days, 90);
assert.equal(receipt.contains_personal_data, false);

const persisted = JSON.parse(await readFile(outputPath, 'utf8'));
assert.deepEqual(persisted, receipt);
assert.equal((await stat(outputPath)).mode & 0o777, 0o600);



const unsanitizedBackupPath = join(dir, 'backup-unsanitized.json');
await writeFile(unsanitizedBackupPath, JSON.stringify({
  schemaVersion: 1,
  kind: 'kairoseth-managed-backup-readiness',
  deploymentProfile: 'kairoseth-hostinger-mongodb',
  status: 'ok',
  provider: 'fixture-managed-backup',
  containsSecrets: true,
  containsFiscalData: false,
  newestBackup: {
    createdAt: '2026-10-03T11:00:00Z',
    sha256: backupSha,
    remote: true,
    encryptedAtRest: true,
  },
  restoreDrill: {
    performedAt: '2026-10-03T11:30:00Z',
    backupSha256: backupSha,
    result: 'ok',
  },
}, null, 2));
await assert.rejects(
  () => buildPilotReadiness({
    bundlePath,
    approvalPath,
    opsStatusPath: opsPath,
    backupReportPath: unsanitizedBackupPath,
    policyPath,
    expectedCommit: commit,
    generatedAt: '2026-10-03T12:30:00Z',
  }),
  (error) => error.code === 'VF_PILOT_BACKUP_EVIDENCE_NOT_SANITIZED',
);

const staleBackupPath = join(dir, 'backup-stale.json');
await writeFile(staleBackupPath, JSON.stringify({
  schemaVersion: 1,
  kind: 'kairoseth-managed-backup-readiness',
  deploymentProfile: 'kairoseth-hostinger-mongodb',
  status: 'ok',
  provider: 'fixture-managed-backup',
  containsSecrets: false,
  containsFiscalData: false,
  newestBackup: {
    createdAt: '2026-09-30T00:00:00Z',
    sha256: backupSha,
    remote: true,
    encryptedAtRest: true,
  },
  restoreDrill: {
    performedAt: '2026-10-03T11:30:00Z',
    backupSha256: backupSha,
    result: 'ok',
  },
}, null, 2));
await assert.rejects(
  () => buildPilotReadiness({
    bundlePath,
    approvalPath,
    opsStatusPath: opsPath,
    backupReportPath: staleBackupPath,
    policyPath,
    expectedCommit: commit,
    generatedAt: '2026-10-03T12:30:00Z',
  }),
  (error) => error.code === 'VF_PILOT_BACKUP_TOO_OLD',
);

const wrongProfileOps = join(dir, 'ops-wrong-profile.json');
await writeFile(wrongProfileOps, JSON.stringify({
  schemaVersion: 1,
  mode: 'single-node-sqlite',
  database: { ok: true },
  aeatOutbox: { available: true, reconciliationRequired: 0, blocked: 0, expiredProcessing: 0 },
  backup: { configured: true, status: 'ok' },
  summary: { status: 'ok', critical: 0, warning: 0 },
}, null, 2));
await assert.rejects(
  () => buildPilotReadiness({
    bundlePath,
    approvalPath,
    opsStatusPath: wrongProfileOps,
    backupReportPath: backupPath,
    policyPath,
    expectedCommit: commit,
  }),
  (error) => error.code === 'VF_PILOT_OPS_PROFILE_MISMATCH',
);

const wrongProfileApproval = join(dir, 'approval-wrong-profile.json');
await writeFile(wrongProfileApproval, JSON.stringify({
  schema_version: 1,
  kind: 'puente-verifactu-pilot-approval',
  candidate_commit: commit,
  deployment_profile: 'sqlite-single-node',
  declaration_sha256: declarationSha,
  declaration_approved: true,
  pilot_approved: true,
  approved_at: '2026-10-03T12:00:00Z',
}, null, 2));
await assert.rejects(
  () => buildPilotReadiness({
    bundlePath,
    approvalPath: wrongProfileApproval,
    opsStatusPath: opsPath,
    backupReportPath: backupPath,
    policyPath,
    expectedCommit: commit,
    generatedAt: '2026-10-03T12:30:00Z',
  }),
  (error) => error.code === 'VF_PILOT_APPROVAL_PROFILE_MISMATCH',
);

const notApproved = join(dir, 'approval-no.json');
await writeFile(notApproved, JSON.stringify({
  schema_version: 1,
  kind: 'puente-verifactu-pilot-approval',
  candidate_commit: commit,
  deployment_profile: 'kairoseth-hostinger-mongodb',
  declaration_sha256: declarationSha,
  declaration_approved: false,
  pilot_approved: false,
  approved_at: '2026-10-03T12:00:00Z',
}));
await assert.rejects(
  () => buildPilotReadiness({
    bundlePath,
    approvalPath: notApproved,
    opsStatusPath: opsPath,
    backupReportPath: backupPath,
    policyPath,
    expectedCommit: commit,
  }),
  (error) => error.code === 'VF_PILOT_APPROVAL_REQUIRED',
);

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'pilot-readiness-contract',
  fail_closed_without_approval: true,
  output_mode: '0600',
  personal_data_in_receipt: false,
}, null, 2));
