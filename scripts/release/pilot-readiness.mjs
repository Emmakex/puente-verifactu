import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEPLOYMENT_PROFILE = 'kairoseth-hostinger-mongodb';
const BACKUP_EVIDENCE_KIND = 'kairoseth-managed-backup-readiness';

function pilotError(code, message) {
  return Object.assign(new Error(message), { code });
}

function argValue(flag, argv = process.argv) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
}

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw pilotError('VF_PILOT_ARGUMENT_REQUIRED', `Missing required argument: ${name}`);
  return text;
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8'));
  } catch (error) {
    throw pilotError(code, `Could not read valid JSON from ${path}: ${String(error?.message ?? error)}`);
  }
}

function sha40(value, name) {
  const text = required(value, name).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(text)) throw pilotError('VF_PILOT_COMMIT_INVALID', `${name} must be a 40-character commit SHA`);
  return text;
}

function sha256(value, name) {
  const text = required(value, name).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) throw pilotError('VF_PILOT_SHA256_INVALID', `${name} must be a SHA-256 fingerprint`);
  return text;
}

function isoDate(value, name) {
  const text = required(value, name);
  if (!Number.isFinite(Date.parse(text))) throw pilotError('VF_PILOT_DATE_INVALID', `${name} must be an ISO date/time`);
  return new Date(text).toISOString();
}

function isInsideRepo(path) {
  const resolved = resolve(path);
  const rel = relative(REPO_ROOT, resolved);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

function validatePolicy(policy) {
  if (policy?.schema_version !== 1 || policy?.kind !== 'puente-verifactu-pilot-policy') {
    throw pilotError('VF_PILOT_POLICY_INVALID', 'Unsupported pilot policy');
  }
  if (policy.deployment_profile !== DEPLOYMENT_PROFILE) {
    throw pilotError(
      'VF_PILOT_POLICY_PROFILE_INVALID',
      `Pilot policy must target ${DEPLOYMENT_PROFILE}`,
    );
  }
  if (policy.backup_evidence_kind !== BACKUP_EVIDENCE_KIND) {
    throw pilotError(
      'VF_PILOT_POLICY_BACKUP_KIND_INVALID',
      `Pilot policy must require ${BACKUP_EVIDENCE_KIND}`,
    );
  }
  if (!Number.isInteger(policy.max_operations) || policy.max_operations < 1) {
    throw pilotError('VF_PILOT_POLICY_SCOPE_INVALID', 'max_operations must be a positive integer');
  }
  if (!Number.isInteger(policy.max_duration_minutes) || policy.max_duration_minutes < 1) {
    throw pilotError('VF_PILOT_POLICY_DURATION_INVALID', 'max_duration_minutes must be a positive integer');
  }
  if (!Number.isInteger(policy.max_backup_age_hours) || policy.max_backup_age_hours < 1) {
    throw pilotError('VF_PILOT_POLICY_BACKUP_AGE_INVALID', 'max_backup_age_hours must be a positive integer');
  }
  if (!Number.isInteger(policy.max_restore_drill_age_days) || policy.max_restore_drill_age_days < 1) {
    throw pilotError(
      'VF_PILOT_POLICY_RESTORE_AGE_INVALID',
      'max_restore_drill_age_days must be a positive integer',
    );
  }
  for (const key of [
    'stop_on_warning',
    'stop_on_rejection',
    'stop_on_reconciliation_required',
    'stop_on_blocked',
    'require_verified_backup',
  ]) {
    if (policy[key] !== true) {
      throw pilotError('VF_PILOT_POLICY_STOP_CONDITION_MISSING', `${key} must be true`);
    }
  }
  if (policy.rollback_mode !== 'code-first-no-automatic-db-restore') {
    throw pilotError('VF_PILOT_POLICY_ROLLBACK_INVALID', 'rollback_mode must preserve the database by default');
  }
  return policy;
}

function validateBundle(bundle, expectedCommit) {
  if (bundle?.schema_version !== 1
    || bundle?.evidence_kind !== 'puente-verifactu-final-release-bundle'
    || bundle?.status !== 'candidate_evidence_complete') {
    throw pilotError('VF_PILOT_BUNDLE_INVALID', 'Final release bundle is not candidate_evidence_complete');
  }
  if (bundle.source_commit !== expectedCommit) {
    throw pilotError('VF_PILOT_BUNDLE_COMMIT_MISMATCH', 'Final release bundle does not match expected commit');
  }
  if (bundle?.release?.status !== 'release_candidate' || bundle?.release?.blockers !== 0) {
    throw pilotError('VF_PILOT_RELEASE_NOT_READY', 'Release candidate status/blockers are not ready for pilot');
  }
  if (bundle?.ci?.result !== 'success') {
    throw pilotError('VF_PILOT_CI_NOT_GREEN', 'Candidate CI result is not success');
  }
  if (bundle?.product?.deployment_profile !== DEPLOYMENT_PROFILE) {
    throw pilotError(
      'VF_PILOT_PROFILE_MISMATCH',
      `Candidate deployment profile is not ${DEPLOYMENT_PROFILE}`,
    );
  }
  if (bundle?.declaration?.present !== true
    || bundle?.declaration?.version_bound !== true
    || bundle?.declaration?.content_in_bundle !== false) {
    throw pilotError('VF_PILOT_DECLARATION_BUNDLE_INVALID', 'Declaration fingerprint is not safely bound to the candidate');
  }
  sha256(bundle.declaration.sha256, 'bundle.declaration.sha256');
  sha256(bundle.release_evidence_sha256, 'bundle.release_evidence_sha256');
  return bundle;
}

function validateApproval(approval, bundle, expectedCommit) {
  if (approval?.schema_version !== 1 || approval?.kind !== 'puente-verifactu-pilot-approval') {
    throw pilotError('VF_PILOT_APPROVAL_INVALID', 'Unsupported pilot approval document');
  }
  if (approval.candidate_commit !== expectedCommit) {
    throw pilotError('VF_PILOT_APPROVAL_COMMIT_MISMATCH', 'Pilot approval does not match expected commit');
  }
  if (approval.deployment_profile !== bundle.product.deployment_profile) {
    throw pilotError(
      'VF_PILOT_APPROVAL_PROFILE_MISMATCH',
      'Pilot approval does not match the candidate deployment profile',
    );
  }
  if (approval.declaration_sha256 !== bundle.declaration.sha256) {
    throw pilotError('VF_PILOT_APPROVAL_DECLARATION_MISMATCH', 'Pilot approval does not match the declaration fingerprint');
  }
  if (approval.declaration_approved !== true || approval.pilot_approved !== true) {
    throw pilotError('VF_PILOT_APPROVAL_REQUIRED', 'Declaration and pilot require explicit human approval');
  }
  return isoDate(approval.approved_at, 'approval.approved_at');
}

function validateOpsStatus(ops) {
  if (ops?.schemaVersion !== 1) throw pilotError('VF_PILOT_OPS_INVALID', 'Operational snapshot schema is invalid');
  if (ops?.mode !== 'kairoseth-mongodb') {
    throw pilotError('VF_PILOT_OPS_PROFILE_MISMATCH', 'Operational snapshot must come from kairoseth-mongodb mode');
  }
  if (ops?.database?.ok !== true || ops?.aeatOutbox?.available !== true) {
    throw pilotError('VF_PILOT_OPS_UNAVAILABLE', 'Database or AEAT outbox is unavailable');
  }
  if (ops?.summary?.status !== 'ok' || Number(ops?.summary?.critical ?? 0) !== 0 || Number(ops?.summary?.warning ?? 0) !== 0) {
    throw pilotError('VF_PILOT_OPS_NOT_CLEAN', 'Operational snapshot must be fully ok with no warnings or critical alerts');
  }
  if (Number(ops?.aeatOutbox?.reconciliationRequired ?? 0) !== 0) {
    throw pilotError('VF_PILOT_RECONCILIATION_PENDING', 'reconciliation_required must be zero before pilot');
  }
  if (Number(ops?.aeatOutbox?.blocked ?? 0) !== 0) {
    throw pilotError('VF_PILOT_BLOCKED_OPERATIONS', 'blocked outbox operations must be zero before pilot');
  }
  if (Number(ops?.aeatOutbox?.expiredProcessing ?? 0) !== 0) {
    throw pilotError('VF_PILOT_EXPIRED_LEASES', 'expired processing leases must be zero before pilot');
  }
  if (ops?.backup?.configured !== true || ops?.backup?.status !== 'ok') {
    throw pilotError('VF_PILOT_BACKUP_MONITORING_NOT_READY', 'Backup monitoring must be configured and ok');
  }
  return ops;
}

function opaqueReference(value, name) {
  const text = required(value, name);
  if (
    text.length > 256
    || /:\/\//.test(text)
    || /[?&](?:token|sig|signature|key|password)=/i.test(text)
  ) {
    throw pilotError(
      'VF_PILOT_BACKUP_REFERENCE_UNSAFE',
      `${name} must be an opaque non-secret reference`,
    );
  }
  return text;
}

function validateBackupReport(report, policy, referenceTime) {
  if (
    report?.schemaVersion !== 1
    || report?.kind !== BACKUP_EVIDENCE_KIND
    || report?.deploymentProfile !== DEPLOYMENT_PROFILE
    || report?.status !== 'ok'
  ) {
    throw pilotError(
      'VF_PILOT_BACKUP_LIFECYCLE_FAILED',
      'Kairoseth managed backup readiness report must be ok and match the candidate profile',
    );
  }
  const provider = opaqueReference(report?.provider, 'backup.provider');
  if (report.containsSecrets !== false || report.containsFiscalData !== false) {
    throw pilotError(
      'VF_PILOT_BACKUP_EVIDENCE_NOT_SANITIZED',
      'Managed backup readiness evidence must explicitly exclude secrets and fiscal data',
    );
  }
  sha256(report?.newestBackup?.sha256, 'backup.newestBackup.sha256');
  if (report?.newestBackup?.encryptedAtRest !== true || report?.newestBackup?.remote !== true) {
    throw pilotError(
      'VF_PILOT_BACKUP_REMOTE_INVALID',
      'Kairoseth backup evidence must prove a remote encrypted backup',
    );
  }
  if (!report?.restoreDrill || report.restoreDrill.result !== 'ok' || !report.restoreDrill.backupSha256) {
    throw pilotError('VF_PILOT_RESTORE_DRILL_MISSING', 'Backup readiness must include a successful restore drill');
  }
  sha256(report.restoreDrill.backupSha256, 'backup.restoreDrill.backupSha256');
  if (report.restoreDrill.backupSha256 !== report.newestBackup.sha256) {
    throw pilotError(
      'VF_PILOT_RESTORE_DRILL_BACKUP_MISMATCH',
      'Restore drill must reference the validated candidate backup fingerprint',
    );
  }

  const now = Date.parse(referenceTime);
  const backupCreated = Date.parse(String(report.newestBackup.createdAt ?? ''));
  const drillPerformed = Date.parse(String(report.restoreDrill.performedAt ?? ''));
  if (!Number.isFinite(now) || !Number.isFinite(backupCreated) || !Number.isFinite(drillPerformed)) {
    throw pilotError(
      'VF_PILOT_BACKUP_TIMESTAMP_INVALID',
      'Backup and restore drill timestamps must be valid ISO dates',
    );
  }
  const backupAgeMs = Math.max(0, now - backupCreated);
  const drillAgeMs = Math.max(0, now - drillPerformed);
  if (backupAgeMs > policy.max_backup_age_hours * 60 * 60 * 1000) {
    throw pilotError('VF_PILOT_BACKUP_TOO_OLD', 'Newest managed backup is older than pilot policy allows');
  }
  if (drillAgeMs > policy.max_restore_drill_age_days * 24 * 60 * 60 * 1000) {
    throw pilotError('VF_PILOT_RESTORE_DRILL_TOO_OLD', 'Restore drill is older than pilot policy allows');
  }
  return {
    ...report,
    _validated: {
      provider,
      backupCreatedAt: new Date(backupCreated).toISOString(),
      restoreDrillAt: new Date(drillPerformed).toISOString(),
    },
  };
}

export async function buildPilotReadiness({
  bundlePath,
  approvalPath,
  opsStatusPath,
  backupReportPath,
  policyPath,
  expectedCommit,
  outputPath = null,
  generatedAt = null,
} = {}) {
  const commit = sha40(expectedCommit, '--expected-commit');
  const approvalResolved = resolve(required(approvalPath, '--approval'));
  if (isInsideRepo(approvalResolved)) {
    throw pilotError('VF_PILOT_APPROVAL_INSIDE_REPOSITORY', 'Private pilot approval must remain outside the repository');
  }

  const [bundle, approval, ops, backup, policy] = await Promise.all([
    readJson(required(bundlePath, '--bundle'), 'VF_PILOT_BUNDLE_INVALID'),
    readJson(approvalResolved, 'VF_PILOT_APPROVAL_INVALID'),
    readJson(required(opsStatusPath, '--ops-status'), 'VF_PILOT_OPS_INVALID'),
    readJson(required(backupReportPath, '--backup-report'), 'VF_PILOT_BACKUP_LIFECYCLE_FAILED'),
    readJson(required(policyPath, '--policy'), 'VF_PILOT_POLICY_INVALID'),
  ]);

  validateBundle(bundle, commit);
  const approvedAt = validateApproval(approval, bundle, commit);
  validateOpsStatus(ops);
  const validatedPolicy = validatePolicy(policy);
  const generated = generatedAt ? isoDate(generatedAt, '--generated-at') : new Date().toISOString();
  const validatedBackup = validateBackupReport(backup, validatedPolicy, generated);

  const receipt = {
    schema_version: 1,
    evidence_kind: 'puente-verifactu-pilot-readiness',
    status: 'pilot_ready',
    generated_at: generated,
    source_commit: commit,
    product: {
      name: bundle.product.name,
      version: bundle.product.version,
      deployment_profile: bundle.product.deployment_profile,
    },
    release: {
      status: bundle.release.status,
      blockers: bundle.release.blockers,
      ci_run_id: bundle.ci.run_id,
      ci_run_number: bundle.ci.run_number,
      release_evidence_sha256: bundle.release_evidence_sha256,
    },
    declaration: {
      approved: true,
      approved_at: approvedAt,
      sha256: bundle.declaration.sha256,
      content_embedded: false,
    },
    operational_readiness: {
      persistence_mode: 'kairoseth-mongodb',
      database_ok: true,
      outbox_available: true,
      reconciliation_required: 0,
      blocked: 0,
      expired_processing: 0,
      ops_status: 'ok',
      backup_status: 'ok',
      backup_provider: validatedBackup._validated.provider,
      backup_created_at: validatedBackup._validated.backupCreatedAt,
      restore_drill_at: validatedBackup._validated.restoreDrillAt,
      backup_sha256: validatedBackup.newestBackup.sha256,
      restore_drill_sha256: validatedBackup.restoreDrill.backupSha256,
    },
    pilot_policy: {
      max_operations: validatedPolicy.max_operations,
      max_duration_minutes: validatedPolicy.max_duration_minutes,
      max_backup_age_hours: validatedPolicy.max_backup_age_hours,
      max_restore_drill_age_days: validatedPolicy.max_restore_drill_age_days,
      backup_evidence_kind: validatedPolicy.backup_evidence_kind,
      stop_on_warning: true,
      stop_on_rejection: true,
      stop_on_reconciliation_required: true,
      stop_on_blocked: true,
      rollback_mode: validatedPolicy.rollback_mode,
    },
    contains_personal_data: false,
  };

  if (outputPath) {
    const target = resolve(outputPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await chmod(target, 0o600);
  }

  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = await buildPilotReadiness({
    bundlePath: argValue('--bundle'),
    approvalPath: argValue('--approval'),
    opsStatusPath: argValue('--ops-status'),
    backupReportPath: argValue('--backup-report'),
    policyPath: argValue('--policy'),
    expectedCommit: argValue('--expected-commit'),
    outputPath: argValue('--output'),
    generatedAt: argValue('--generated-at'),
  });
  console.log(JSON.stringify(receipt, null, 2));
}
