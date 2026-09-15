import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlitePersistence } from '../../../packages/sqlite-store/src/index.mjs';
import { createOperationalObserver } from '../src/observability.mjs';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'puente-verifactu-observability-'));
  return {
    directory,
    manifestPath: join(directory, 'backup.sqlite.manifest.json'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function codes(snapshot) {
  return snapshot.alerts.map((item) => item.code);
}

test('operational snapshot exposes aggregate outbox health and stable alerts without payload data', () => {
  const files = fixture();
  const persistence = createSqlitePersistence({ path: ':memory:' });
  const now = Date.parse('2026-09-15T18:00:00Z');
  const jobIds = [
    'job_id_pnd_7f3a',
    'job_id_rec_8b4c',
    'job_id_blk_9c5d',
    'job_id_lease_ad6e',
  ];
  try {
    persistence.aeatOutbox.enqueue({ secretInvoice: 'SHOULD-NOT-LEAK' }, {
      id: jobIds[0],
      availableAt: now - 20 * 60 * 1000,
      now: now - 20 * 60 * 1000,
    });

    persistence.aeatOutbox.enqueue({ secretInvoice: 'RECONCILE-SECRET' }, { id: jobIds[1], availableAt: 0, now: now - 5000 });
    persistence.aeatOutbox.claim(jobIds[1], { owner: 'dead-worker', now: now - 5000, leaseMs: 1 });
    persistence.aeatOutbox.recoverExpired(now - 4000);

    persistence.aeatOutbox.enqueue({ secretInvoice: 'BLOCKED-SECRET' }, { id: jobIds[2], availableAt: 0, now: now - 3000 });
    persistence.aeatOutbox.claim(jobIds[2], { owner: 'worker', now: now - 3000, leaseMs: 5000 });
    persistence.aeatOutbox.settle(jobIds[2], { owner: 'worker', state: 'blocked', lastResult: { kind: 'test' }, now: now - 2000 });

    persistence.aeatOutbox.enqueue({ secretInvoice: 'LEASE-SECRET' }, { id: jobIds[3], availableAt: 0, now: now - 2000 });
    persistence.aeatOutbox.claim(jobIds[3], { owner: 'stuck-worker', now: now - 2000, leaseMs: 100 });

    writeFileSync(files.manifestPath, JSON.stringify({
      schema_version: 1,
      kind: 'puente-sqlite-backup',
      created_at: new Date(now - 60 * 60 * 60 * 1000).toISOString(),
    }));

    const observer = createOperationalObserver({
      persistence,
      backupManifestPath: files.manifestPath,
      clock: () => now,
    });
    const snapshot = observer.snapshot();

    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.database.ok, true);
    assert.equal(snapshot.aeatOutbox.available, true);
    assert.equal(snapshot.aeatOutbox.pending, 1);
    assert.equal(snapshot.aeatOutbox.processing, 1);
    assert.equal(snapshot.aeatOutbox.reconciliationRequired, 1);
    assert.equal(snapshot.aeatOutbox.blocked, 1);
    assert.equal(snapshot.aeatOutbox.expiredProcessing, 1);
    assert.equal(snapshot.aeatOutbox.oldestPendingAgeMs, 20 * 60 * 1000);
    assert.equal(snapshot.backup.status, 'ok');
    assert.equal(snapshot.summary.status, 'critical');
    assert.ok(codes(snapshot).includes('VF_OBS_AEAT_RECONCILIATION_REQUIRED'));
    assert.ok(codes(snapshot).includes('VF_OBS_AEAT_OUTBOX_BLOCKED'));
    assert.ok(codes(snapshot).includes('VF_OBS_AEAT_LEASE_EXPIRED'));
    assert.ok(codes(snapshot).includes('VF_OBS_AEAT_PENDING_AGE_CRITICAL'));
    assert.ok(codes(snapshot).includes('VF_OBS_BACKUP_AGE_CRITICAL'));
    const serialized = JSON.stringify(snapshot);
    assert.doesNotMatch(serialized, /SHOULD-NOT-LEAK|RECONCILE-SECRET|BLOCKED-SECRET|LEASE-SECRET/);
    for (const jobId of jobIds) assert.equal(serialized.includes(jobId), false);
  } finally {
    persistence.close();
    files.cleanup();
  }
});

test('operational snapshot remains available and sanitized after SQLite becomes unavailable', () => {
  const persistence = createSqlitePersistence({ path: ':memory:' });
  const observer = createOperationalObserver({ persistence, clock: () => 1000 });
  persistence.close();

  const snapshot = observer.snapshot();
  assert.equal(snapshot.database.ok, false);
  assert.equal(snapshot.aeatOutbox.available, false);
  assert.equal(snapshot.summary.status, 'critical');
  assert.ok(codes(snapshot).includes('VF_OBS_DATABASE_UNAVAILABLE'));
  assert.ok(codes(snapshot).includes('VF_OBS_AEAT_OUTBOX_UNAVAILABLE'));
});
