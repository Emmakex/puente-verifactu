import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FiscalRecordService } from '../../core/src/fiscal-record-service.mjs';
import { UniversalBridgeService } from '../../../apps/api/src/service.mjs';
import { ImportSessionService } from '../../../apps/api/src/imports.mjs';
import { createSqlitePersistence } from '../src/index.mjs';

const sif = { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' };
const context = { organizationId: 'org-test', installationId: 'install-test', sourceSystem: 'test-system' };

function intent(sourceInvoiceId = 'INV-1', number = '1') {
  return {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: context.organizationId,
    installationId: context.installationId,
    sourceSystem: context.sourceSystem,
    sourceInvoiceId,
    number,
    series: 'A',
    issueDate: '2026-09-15',
    invoiceType: 'F2',
    description: 'Servicio de prueba',
    issuer: { name: 'Empresa Demo', taxId: 'TESTISSUER' },
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

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'puente-verifactu-sqlite-'));
  return {
    directory,
    path: join(directory, 'puente.sqlite'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
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

test('fiscal chain and API idempotency survive a process restart', async () => {
  const files = fixture();
  try {
    let persistence = createSqlitePersistence({ path: files.path });
    let service = bridge(persistence);
    const first = await service.issue(intent(), context, { idempotencyKey: 'event-1' });
    assert.equal(first.duplicate, false);
    assert.equal(first.fiscalRecord.sequence, 1);
    const recordId = first.recordId;
    persistence.close();

    persistence = createSqlitePersistence({ path: files.path });
    service = bridge(persistence);
    const repeated = await service.issue(intent(), context, { idempotencyKey: 'event-1' });
    assert.equal(repeated.duplicate, true);
    assert.equal(repeated.recordId, recordId);
    assert.equal(persistence.fiscalStore.list(first.fiscalRecord.chainKey).length, 1);

    const second = await service.issue(intent('INV-2', '2'), context, { idempotencyKey: 'event-2' });
    assert.equal(second.fiscalRecord.sequence, 2);
    assert.equal(second.fiscalRecord.previous.hash, first.fiscalRecord.hash);
    persistence.close();
  } finally {
    files.cleanup();
  }
});

test('SQLite integration reservation is not duplicate on first use and conflicts on changed content', () => {
  const persistence = createSqlitePersistence({ path: ':memory:' });
  try {
    const payload = { invoice: 'A-1', total: '121.00' };
    const first = persistence.integrationStore.reserve('req-1', payload);
    assert.equal(first.duplicate, false);
    assert.equal(first.existing.recordId, null);

    const pendingRepeat = persistence.integrationStore.reserve('req-1', payload);
    assert.equal(pendingRepeat.duplicate, true);
    assert.equal(pendingRepeat.existing.recordId, null);

    assert.throws(
      () => persistence.integrationStore.reserve('req-1', { ...payload, total: '999.00' }),
      { code: 'VF_API_IDEMPOTENCY_CONFLICT' },
    );

    persistence.integrationStore.put({
      recordId: 'fr_test',
      organizationId: 'org-test',
      installationId: 'install-test',
      sourceInvoiceId: 'A-1',
      status: 'fiscalized',
    });
    persistence.integrationStore.complete('req-1', payload, 'fr_test');
    const completed = persistence.integrationStore.reserve('req-1', payload);
    assert.equal(completed.duplicate, true);
    assert.equal(completed.existing.recordId, 'fr_test');
  } finally {
    persistence.close();
  }
});

test('parsed import session survives restart and expires without storing original binary', () => {
  const files = fixture();
  let now = Date.parse('2026-09-15T09:00:00Z');
  const csv = Buffer.from([
    'Nº Factura;Fecha factura;Concepto;Base imponible;Cuota IVA;Total factura',
    'A-1;15/09/2026;Servicio;100,00;21,00;121,00',
  ].join('\n'));

  try {
    let persistence = createSqlitePersistence({ path: files.path });
    let imports = new ImportSessionService({
      clock: () => now,
      ttlMs: 60_000,
      store: persistence.importStore,
    });
    const inspected = imports.inspect({ buffer: csv, filename: 'facturas.csv', context });
    assert.equal(inspected.file.rows, 1);
    persistence.close();

    persistence = createSqlitePersistence({ path: files.path });
    imports = new ImportSessionService({
      clock: () => now,
      ttlMs: 60_000,
      store: persistence.importStore,
    });
    const restored = imports.session(inspected.importId, context);
    assert.equal(restored.rows[0]['Nº Factura'], 'A-1');
    assert.equal('buffer' in restored, false);
    assert.equal('rawBody' in restored, false);

    now += 60_001;
    assert.throws(() => imports.session(inspected.importId, context), { code: 'VF_IMPORT_SESSION_EXPIRED' });
    assert.equal(persistence.importStore.get(inspected.importId), null);
    persistence.close();
  } finally {
    files.cleanup();
  }
});
