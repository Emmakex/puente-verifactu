import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildBackupRetentionPlan,
  createSqliteBackup,
  createSqlitePersistence,
  evaluateBackupLifecycle,
  validateBackupLifecyclePolicy,
} from '../src/index.mjs';
import { performRestoreDrill } from '../../../scripts/ops/backup-lifecycle.mjs';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'puente-backup-lifecycle-'));
  return {
    directory,
    dbPath: join(directory, 'source.sqlite'),
    remoteEvidencePath: join(directory, 'remote-evidence.json'),
    drillEvidencePath: join(directory, 'restore-drill.json'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function policy(overrides = {}) {
  return validateBackupLifecyclePolicy({
    schema_version: 1,
    max_local_backup_age_hours: 26,
    remote_copy_required: true,
    remote_encryption_required: true,
    restore_drill_max_age_days: 90,
    retention: { daily: 7, weekly: 5, monthly: 12 },
    ...overrides,
  });
}

test('retention plan keeps daily/weekly/monthly buckets and only proposes pruning', () => {
  const backups = [
    ['2026-09-15T10:00:00Z', 'a'.repeat(64)],
    ['2026-09-14T10:00:00Z', 'b'.repeat(64)],
    ['2026-09-13T10:00:00Z', 'c'.repeat(64)],
    ['2026-08-01T10:00:00Z', 'd'.repeat(64)],
    ['2026-07-01T10:00:00Z', 'e'.repeat(64)],
    ['2026-06-01T10:00:00Z', 'f'.repeat(64)],
  ].map(([createdAt, sha256], index) => ({ artifact: `b${index}.sqlite`, createdAt, sha256 }));

  const plan = buildBackupRetentionPlan(backups, { daily: 2, weekly: 2, monthly: 2 });
  assert.ok(plan.keep.length >= 2);
  assert.ok(plan.pruneCandidates.length >= 1);
  assert.equal(plan.keep.length + plan.pruneCandidates.length, backups.length);
  assert.ok(plan.keep.some((item) => item.sha256 === 'a'.repeat(64)));
  assert.ok(plan.pruneCandidates.some((item) => item.sha256 === 'f'.repeat(64)));
});

test('lifecycle check verifies real backups, encrypted remote evidence and restore drill', () => {
  const files = fixture();
  const persistence = createSqlitePersistence({ path: files.dbPath });
  try {
    persistence.database.db.exec('CREATE TABLE lifecycle_fixture (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    persistence.database.db.prepare('INSERT INTO lifecycle_fixture (value) VALUES (?)').run('first');

    const firstPath = join(files.directory, 'puente-20260914.sqlite');
    const first = createSqliteBackup({
      sourcePath: files.dbPath,
      backupPath: firstPath,
      clock: () => new Date('2026-09-14T08:00:00Z'),
    });

    persistence.database.db.prepare('INSERT INTO lifecycle_fixture (value) VALUES (?)').run('second');
    const secondPath = join(files.directory, 'puente-20260915.sqlite');
    const second = createSqliteBackup({
      sourcePath: files.dbPath,
      backupPath: secondPath,
      clock: () => new Date('2026-09-15T08:00:00Z'),
    });

    writeFileSync(files.remoteEvidencePath, JSON.stringify({
      schema_version: 1,
      kind: 'puente-backup-remote-evidence',
      copies: [first, second].map((backup, index) => ({
        sha256: backup.sha256,
        copied_at: `2026-09-${index === 0 ? '14' : '15'}T09:00:00Z`,
        encrypted_at_rest: true,
        reference: `remote-object-${index + 1}`,
      })),
    }, null, 2));

    const drill = performRestoreDrill({
      backupPath: secondPath,
      evidencePath: files.drillEvidencePath,
      clock: () => new Date('2026-09-15T10:00:00Z'),
    });
    assert.equal(drill.result, 'ok');
    assert.equal(drill.backup_sha256, second.sha256);
    assert.equal(JSON.parse(readFileSync(files.drillEvidencePath, 'utf8')).checks.integrity_check, 'ok');

    const report = evaluateBackupLifecycle({
      directory: files.directory,
      policy: policy(),
      remoteEvidencePath: files.remoteEvidencePath,
      restoreDrillEvidencePath: files.drillEvidencePath,
      clock: () => new Date('2026-09-15T12:00:00Z'),
    });

    assert.equal(report.status, 'ok');
    assert.equal(report.backupCount, 2);
    assert.equal(report.newestBackup.sha256, second.sha256);
    assert.equal(report.failures.length, 0);
    assert.ok(report.retained.every((item) => item.remoteCopy && item.remoteEncrypted));
  } finally {
    persistence.close();
    files.cleanup();
  }
});

test('lifecycle check fails closed when remote encryption or restore evidence is missing', () => {
  const files = fixture();
  const persistence = createSqlitePersistence({ path: files.dbPath });
  try {
    persistence.database.db.exec('CREATE TABLE lifecycle_fixture (id INTEGER PRIMARY KEY)');
    const backupPath = join(files.directory, 'puente-20260915.sqlite');
    const backup = createSqliteBackup({
      sourcePath: files.dbPath,
      backupPath,
      clock: () => new Date('2026-09-15T08:00:00Z'),
    });

    writeFileSync(files.remoteEvidencePath, JSON.stringify({
      schema_version: 1,
      kind: 'puente-backup-remote-evidence',
      copies: [{
        sha256: backup.sha256,
        copied_at: '2026-09-15T09:00:00Z',
        encrypted_at_rest: false,
        reference: 'unsafe-copy',
      }],
    }));

    const report = evaluateBackupLifecycle({
      directory: files.directory,
      policy: policy(),
      remoteEvidencePath: files.remoteEvidencePath,
      restoreDrillEvidencePath: null,
      clock: () => new Date('2026-09-15T12:00:00Z'),
    });
    const codes = report.failures.map((failure) => failure.code);
    assert.equal(report.status, 'failed');
    assert.ok(codes.includes('VF_BACKUP_REMOTE_COPY_NOT_ENCRYPTED'));
    assert.ok(codes.includes('VF_BACKUP_RESTORE_DRILL_MISSING'));
  } finally {
    persistence.close();
    files.cleanup();
  }
});
