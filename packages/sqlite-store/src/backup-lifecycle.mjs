import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifySqliteBackup } from './backup.mjs';

const POLICY_SCHEMA_VERSION = 1;
const REMOTE_EVIDENCE_KIND = 'puente-backup-remote-evidence';
const RESTORE_DRILL_KIND = 'puente-backup-restore-drill';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function lifecycleError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function readJson(path, code, message) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw lifecycleError(code, message, { cause: String(error?.message ?? error) });
  }
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw lifecycleError('VF_BACKUP_POLICY_INVALID', `${name} must be a positive integer`);
  }
  return value;
}

export function validateBackupLifecyclePolicy(input) {
  if (input?.schema_version !== POLICY_SCHEMA_VERSION) {
    throw lifecycleError('VF_BACKUP_POLICY_INVALID', 'Unsupported backup policy schema_version');
  }
  const retention = input.retention ?? {};
  return Object.freeze({
    schemaVersion: POLICY_SCHEMA_VERSION,
    maxLocalBackupAgeHours: positiveInteger(input.max_local_backup_age_hours, 'max_local_backup_age_hours'),
    remoteCopyRequired: input.remote_copy_required === true,
    remoteEncryptionRequired: input.remote_encryption_required === true,
    restoreDrillMaxAgeDays: positiveInteger(input.restore_drill_max_age_days, 'restore_drill_max_age_days'),
    retention: Object.freeze({
      daily: positiveInteger(retention.daily, 'retention.daily'),
      weekly: positiveInteger(retention.weekly, 'retention.weekly'),
      monthly: positiveInteger(retention.monthly, 'retention.monthly'),
    }),
  });
}

export function loadBackupLifecyclePolicy(path) {
  const resolved = resolve(String(path ?? ''));
  if (!existsSync(resolved)) throw lifecycleError('VF_BACKUP_POLICY_MISSING', 'Backup lifecycle policy file does not exist');
  return validateBackupLifecyclePolicy(readJson(resolved, 'VF_BACKUP_POLICY_INVALID', 'Backup lifecycle policy is invalid JSON'));
}

function isoWeekKey(date) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / DAY_MS) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function bucketKey(kind, createdAt) {
  const date = new Date(createdAt);
  if (kind === 'daily') return date.toISOString().slice(0, 10);
  if (kind === 'weekly') return isoWeekKey(date);
  if (kind === 'monthly') return date.toISOString().slice(0, 7);
  throw new TypeError(`Unsupported retention bucket: ${kind}`);
}

export function buildBackupRetentionPlan(backups, retention) {
  const ordered = [...backups].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const keep = new Set();
  for (const kind of ['daily', 'weekly', 'monthly']) {
    const seen = new Set();
    for (const backup of ordered) {
      const key = bucketKey(kind, backup.createdAt);
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size <= retention[kind]) keep.add(backup.sha256);
    }
  }
  return Object.freeze({
    keep: Object.freeze(ordered.filter((backup) => keep.has(backup.sha256))),
    pruneCandidates: Object.freeze(ordered.filter((backup) => !keep.has(backup.sha256))),
  });
}

function discoverBackups(directory) {
  const root = resolve(String(directory ?? ''));
  if (!existsSync(root)) throw lifecycleError('VF_BACKUP_DIRECTORY_MISSING', 'Backup directory does not exist');
  const manifests = readdirSync(root)
    .filter((name) => name.endsWith('.sqlite.manifest.json'))
    .sort();
  if (manifests.length === 0) throw lifecycleError('VF_BACKUP_DIRECTORY_EMPTY', 'Backup directory contains no backup manifests');
  return manifests.map((manifestName) => {
    const manifestPath = resolve(root, manifestName);
    const backupPath = manifestPath.slice(0, -'.manifest.json'.length);
    const verified = verifySqliteBackup({ backupPath, manifestPath });
    const createdAt = String(verified.manifest.created_at);
    if (!Number.isFinite(Date.parse(createdAt))) {
      throw lifecycleError('VF_BACKUP_MANIFEST_DATE_INVALID', 'Backup manifest created_at is invalid');
    }
    return Object.freeze({
      artifact: verified.manifest.artifact,
      createdAt: new Date(createdAt).toISOString(),
      sha256: verified.sha256,
      bytes: verified.bytes,
      backupPath: verified.backupPath,
      manifestPath: verified.manifestPath,
    });
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function loadRemoteEvidence(path) {
  if (!path) return [];
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw lifecycleError('VF_BACKUP_REMOTE_EVIDENCE_MISSING', 'Remote copy evidence file does not exist');
  const evidence = readJson(resolved, 'VF_BACKUP_REMOTE_EVIDENCE_INVALID', 'Remote copy evidence is invalid JSON');
  if (evidence?.schema_version !== 1 || evidence?.kind !== REMOTE_EVIDENCE_KIND || !Array.isArray(evidence?.copies)) {
    throw lifecycleError('VF_BACKUP_REMOTE_EVIDENCE_INVALID', 'Remote copy evidence schema is invalid');
  }
  return evidence.copies.map((copy, index) => {
    const sha256 = String(copy?.sha256 ?? '');
    const copiedAt = String(copy?.copied_at ?? '');
    if (!/^[a-f0-9]{64}$/i.test(sha256) || !Number.isFinite(Date.parse(copiedAt))) {
      throw lifecycleError('VF_BACKUP_REMOTE_EVIDENCE_INVALID', `Remote copy evidence item ${index} is invalid`);
    }
    return Object.freeze({
      sha256: sha256.toLowerCase(),
      copiedAt: new Date(copiedAt).toISOString(),
      encryptedAtRest: copy?.encrypted_at_rest === true,
      reference: typeof copy?.reference === 'string' && copy.reference.trim() ? copy.reference.trim().slice(0, 200) : null,
    });
  });
}

function loadRestoreDrill(path) {
  if (!path) return null;
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw lifecycleError('VF_BACKUP_RESTORE_DRILL_EVIDENCE_MISSING', 'Restore drill evidence file does not exist');
  const evidence = readJson(resolved, 'VF_BACKUP_RESTORE_DRILL_EVIDENCE_INVALID', 'Restore drill evidence is invalid JSON');
  if (evidence?.schema_version !== 1 || evidence?.kind !== RESTORE_DRILL_KIND || evidence?.result !== 'ok') {
    throw lifecycleError('VF_BACKUP_RESTORE_DRILL_EVIDENCE_INVALID', 'Restore drill evidence schema or result is invalid');
  }
  const performedAt = String(evidence.performed_at ?? '');
  const sha256 = String(evidence.backup_sha256 ?? '');
  if (!Number.isFinite(Date.parse(performedAt)) || !/^[a-f0-9]{64}$/i.test(sha256)) {
    throw lifecycleError('VF_BACKUP_RESTORE_DRILL_EVIDENCE_INVALID', 'Restore drill timestamp or checksum is invalid');
  }
  return Object.freeze({
    performedAt: new Date(performedAt).toISOString(),
    backupSha256: sha256.toLowerCase(),
  });
}

export function evaluateBackupLifecycle({
  directory,
  policy,
  remoteEvidencePath = null,
  restoreDrillEvidencePath = null,
  clock = () => new Date(),
} = {}) {
  const normalizedPolicy = policy?.schemaVersion === POLICY_SCHEMA_VERSION ? policy : validateBackupLifecyclePolicy(policy);
  const nowDate = clock();
  if (!(nowDate instanceof Date) || Number.isNaN(nowDate.getTime())) {
    throw lifecycleError('VF_BACKUP_LIFECYCLE_CLOCK_INVALID', 'Backup lifecycle clock must return a valid Date');
  }
  const now = nowDate.getTime();
  const backups = discoverBackups(directory);
  const retentionPlan = buildBackupRetentionPlan(backups, normalizedPolicy.retention);
  const remoteEvidence = loadRemoteEvidence(remoteEvidencePath);
  const remoteByHash = new Map(remoteEvidence.map((item) => [item.sha256, item]));
  const restoreDrill = loadRestoreDrill(restoreDrillEvidencePath);
  const failures = [];
  const warnings = [];

  const newest = backups[0];
  const newestAgeMs = Math.max(0, now - Date.parse(newest.createdAt));
  if (newestAgeMs > normalizedPolicy.maxLocalBackupAgeHours * HOUR_MS) {
    failures.push({
      code: 'VF_BACKUP_LATEST_TOO_OLD',
      age_hours: Math.floor(newestAgeMs / HOUR_MS),
      max_hours: normalizedPolicy.maxLocalBackupAgeHours,
    });
  }

  if (normalizedPolicy.remoteCopyRequired) {
    for (const backup of retentionPlan.keep) {
      const evidence = remoteByHash.get(backup.sha256.toLowerCase());
      if (!evidence) {
        failures.push({ code: 'VF_BACKUP_REMOTE_COPY_MISSING', sha256: backup.sha256 });
        continue;
      }
      if (normalizedPolicy.remoteEncryptionRequired && !evidence.encryptedAtRest) {
        failures.push({ code: 'VF_BACKUP_REMOTE_COPY_NOT_ENCRYPTED', sha256: backup.sha256 });
      }
    }
  }

  if (!restoreDrill) {
    failures.push({ code: 'VF_BACKUP_RESTORE_DRILL_MISSING' });
  } else {
    const drillAgeMs = Math.max(0, now - Date.parse(restoreDrill.performedAt));
    if (drillAgeMs > normalizedPolicy.restoreDrillMaxAgeDays * DAY_MS) {
      failures.push({
        code: 'VF_BACKUP_RESTORE_DRILL_TOO_OLD',
        age_days: Math.floor(drillAgeMs / DAY_MS),
        max_days: normalizedPolicy.restoreDrillMaxAgeDays,
      });
    }
    if (!backups.some((backup) => backup.sha256.toLowerCase() === restoreDrill.backupSha256)) {
      failures.push({ code: 'VF_BACKUP_RESTORE_DRILL_UNKNOWN_BACKUP', sha256: restoreDrill.backupSha256 });
    }
  }

  if (retentionPlan.pruneCandidates.length > 0) {
    warnings.push({ code: 'VF_BACKUP_RETENTION_PRUNE_CANDIDATES', count: retentionPlan.pruneCandidates.length });
  }

  return Object.freeze({
    schemaVersion: 1,
    status: failures.length > 0 ? 'failed' : 'ok',
    generatedAt: nowDate.toISOString(),
    newestBackup: Object.freeze({ createdAt: newest.createdAt, sha256: newest.sha256, ageMs: newestAgeMs }),
    backupCount: backups.length,
    retainedCount: retentionPlan.keep.length,
    pruneCandidateCount: retentionPlan.pruneCandidates.length,
    retained: Object.freeze(retentionPlan.keep.map((backup) => Object.freeze({
      artifact: backup.artifact,
      createdAt: backup.createdAt,
      sha256: backup.sha256,
      remoteCopy: remoteByHash.has(backup.sha256.toLowerCase()),
      remoteEncrypted: remoteByHash.get(backup.sha256.toLowerCase())?.encryptedAtRest ?? false,
    }))),
    pruneCandidates: Object.freeze(retentionPlan.pruneCandidates.map((backup) => Object.freeze({
      artifact: backup.artifact,
      createdAt: backup.createdAt,
      sha256: backup.sha256,
    }))),
    restoreDrill,
    failures: Object.freeze(failures),
    warnings: Object.freeze(warnings),
  });
}

export const BACKUP_LIFECYCLE_EVIDENCE_KINDS = Object.freeze({
  remote: REMOTE_EVIDENCE_KIND,
  restoreDrill: RESTORE_DRILL_KIND,
});
