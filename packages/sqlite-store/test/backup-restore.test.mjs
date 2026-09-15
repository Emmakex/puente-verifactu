import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FiscalRecordService } from '../../core/src/fiscal-record-service.mjs';
import { UniversalBridgeService } from '../../../apps/api/src/service.mjs';
import {
  createSqliteBackup,
  createSqlitePersistence,
  restoreSqliteBackup,
  verifySqliteBackup,
} from '../src/index.mjs';

const sif = { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' };
const context = { organizationId: 'org-backup', installationId: 'install-backup', sourceSystem: 'backup-test' };

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'puente-verifactu-backup-'));
  return {
    directory,
    source: join(directory, 'source.sqlite'),
    backup: join(directory, 'backup.sqlite'),
    restored: join(directory, 'restored.sqlite'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function intent(sourceInvoiceId, number) {
  return {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: context.organizationId,
    installationId: context.installationId,
    sourceSystem: context.sourceSystem,
    sourceInvoiceId,
    number,
    series: 'B',
    issueDate: '2026-09-15',
    invoiceType: 'F2',
    description: 'Backup restore test',
    issuer: { name: 'Backup Test', taxId: 'BACKUPTEST' },
    currency: 'EUR',
    taxBreakdown: [{
      taxCode: '01',
      regimeKey: '01',
      operationClass: 'S1',
      rate: '21',
      baseAmount: '100.00',
      taxAmount: '21.00',
    }],
    totals: { baseAmount: '100.00', taxAmount: '21.00', totalAmount: '121.00' },
  };
}

function bridge(persistence) {
  const fiscalService = new FiscalRecordService({
    sif,
    store: persistence.fiscalStore,
    clock: () => new Date('2026-09-15T09:00:00Z'),
  });
  return new UniversalBridgeService({ fiscalService, store: persistence.integrationStore });
}

test('live WAL backup is a verified point-in-time snapshot and restores all durable stores', async () => {
  const files = fixture();
  try {
    const persistence = createSqlitePersistence({ path: files.source });
    const service = bridge(persistence);
    const first = await service.issue(intent('BACKUP-1', '1'), context, { idempotencyKey: 'backup-event-1' });
    persistence.importStore.put({
      importId: 'imp_backup',
      organizationId: context.organizationId,
      installationId: context.installationId,
      createdAt: Date.parse('2026-09-15T09:00:00Z'),
      expiresAt: Date.parse('2026-09-16T09:00:00Z'),
      rows: [{ number: '1' }],
    });

    const created = createSqliteBackup({
      sourcePath: files.source,
      backupPath: files.backup,
      clock: () => new Date('2026-09-15T10:00:00Z'),
    });
    assert.equal(created.inspection.integrityCheck, 'ok');
    assert.equal(created.inspection.foreignKeyCheck, 'ok');
    assert.equal(created.manifest.created_at, '2026-09-15T10:00:00.000Z');
    assert.equal(created.manifest.source_filename, 'source.sqlite');
    assert.equal(JSON.stringify(created.manifest).includes(files.directory), false, 'manifest must not leak absolute infrastructure paths');

    const second = await service.issue(intent('BACKUP-2', '2'), context, { idempotencyKey: 'backup-event-2' });
    assert.equal(second.fiscalRecord.sequence, 2);
    persistence.close();

    const verified = verifySqliteBackup({ backupPath: files.backup });
    assert.equal(verified.sha256, created.sha256);
    assert.ok(verified.bytes > 0);

    const restore = restoreSqliteBackup({ backupPath: files.backup, targetPath: files.restored });
    assert.equal(restore.sha256, created.sha256);
    assert.equal(restore.inspection.integrityCheck, 'ok');

    const restored = createSqlitePersistence({ path: files.restored });
    try {
      assert.ok(restored.integrationStore.get(first.recordId));
      assert.equal(restored.integrationStore.get(second.recordId), null, 'post-backup writes must not appear in snapshot');
      assert.deepEqual(restored.importStore.get('imp_backup').rows, [{ number: '1' }]);
      const chain = restored.fiscalStore.list(first.fiscalRecord.chainKey);
      assert.equal(chain.length, 1);
      assert.equal(chain[0].hash, first.fiscalRecord.hash);
    } finally {
      restored.close();
    }
  } finally {
    files.cleanup();
  }
});

test('corrupted backup is rejected before an existing target can be replaced', () => {
  const files = fixture();
  try {
    const source = createSqlitePersistence({ path: files.source });
    source.integrationStore.put({
      recordId: 'fr_source', organizationId: 'org-backup', installationId: 'install-backup', status: 'source',
    });
    source.close();
    createSqliteBackup({ sourcePath: files.source, backupPath: files.backup });

    const target = createSqlitePersistence({ path: files.restored });
    target.integrationStore.put({
      recordId: 'fr_target_sentinel', organizationId: 'org-target', installationId: 'install-target', status: 'keep-me',
    });
    target.close();

    writeFileSync(files.backup, Buffer.from('corrupted-backup'));
    assert.throws(
      () => restoreSqliteBackup({
        backupPath: files.backup,
        targetPath: files.restored,
        replace: true,
        offlineConfirmation: true,
      }),
      { code: 'VF_SQLITE_BACKUP_SIZE_MISMATCH' },
    );

    const unchanged = createSqlitePersistence({ path: files.restored });
    try {
      assert.equal(unchanged.integrationStore.get('fr_target_sentinel').status, 'keep-me');
    } finally {
      unchanged.close();
    }
  } finally {
    files.cleanup();
  }
});

test('in-place restore requires explicit offline confirmation and rejects active WAL sidecars', () => {
  const files = fixture();
  try {
    const source = createSqlitePersistence({ path: files.source });
    source.integrationStore.put({
      recordId: 'fr_backup_value', organizationId: 'org-backup', installationId: 'install-backup', status: 'backup',
    });
    source.close();
    createSqliteBackup({ sourcePath: files.source, backupPath: files.backup });

    let target = createSqlitePersistence({ path: files.restored });
    target.integrationStore.put({
      recordId: 'fr_old_value', organizationId: 'org-target', installationId: 'install-target', status: 'old',
    });

    assert.throws(
      () => restoreSqliteBackup({
        backupPath: files.backup,
        targetPath: files.restored,
        replace: true,
        offlineConfirmation: true,
      }),
      { code: 'VF_SQLITE_RESTORE_TARGET_BUSY' },
    );
    target.close();

    assert.throws(
      () => restoreSqliteBackup({ backupPath: files.backup, targetPath: files.restored, replace: true }),
      { code: 'VF_SQLITE_RESTORE_OFFLINE_CONFIRMATION_REQUIRED' },
    );

    restoreSqliteBackup({
      backupPath: files.backup,
      targetPath: files.restored,
      replace: true,
      offlineConfirmation: true,
    });

    target = createSqlitePersistence({ path: files.restored });
    try {
      assert.equal(target.integrationStore.get('fr_old_value'), null);
      assert.equal(target.integrationStore.get('fr_backup_value').status, 'backup');
    } finally {
      target.close();
    }
  } finally {
    files.cleanup();
  }
});

test('backup refuses in-memory databases and never overwrites an existing artifact', () => {
  const files = fixture();
  try {
    assert.throws(
      () => createSqliteBackup({ sourcePath: ':memory:', backupPath: files.backup }),
      { code: 'VF_SQLITE_DISK_PATH_REQUIRED' },
    );

    const persistence = createSqlitePersistence({ path: files.source });
    persistence.close();
    createSqliteBackup({ sourcePath: files.source, backupPath: files.backup });
    const original = readFileSync(files.backup);
    assert.throws(
      () => createSqliteBackup({ sourcePath: files.source, backupPath: files.backup }),
      { code: 'VF_SQLITE_BACKUP_EXISTS' },
    );
    assert.deepEqual(readFileSync(files.backup), original);
  } finally {
    files.cleanup();
  }
});
