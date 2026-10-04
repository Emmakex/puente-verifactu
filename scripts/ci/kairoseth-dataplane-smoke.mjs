import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { FiscalRecordService, verifyFiscalChain } from '../../packages/core/src/fiscal-record-service.mjs';
import { UniversalBridgeService } from '../../apps/api/src/service.mjs';
import {
  createMongoKairosethFiscalRecordStore,
  createMongoKairosethIntegrationStore,
  mongoFiscalRecordIndexes,
  mongoIntegrationRecordIndexes,
  mongoIntegrationRequestIndexes,
} from '../../packages/kairoseth-control-plane/src/mongodb-dataplane.mjs';

const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018';
const client = new MongoClient(uri);
const databaseName = 'kairoseth_dataplane_smoke';

function invoice(sourceInvoiceId, number) {
  return {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: 'org-dataplane',
    installationId: 'install-dataplane',
    sourceSystem: 'api-smoke',
    sourceInvoiceId,
    series: 'DP-',
    number,
    issueDate: '2026-10-04',
    invoiceType: 'F2',
    description: 'Data plane smoke',
    issuer: { name: 'Empresa Demo', taxId: '89890001K' },
    currency: 'EUR',
    taxBreakdown: [{
      taxCode: '01',
      regimeKey: '01',
      operationClass: 'S1',
      rate: '21',
      baseAmount: '100.00',
      taxAmount: '21.00',
    }],
    adjustments: [],
    totals: {
      baseAmount: '100.00',
      taxAmount: '21.00',
      totalAmount: '121.00',
    },
  };
}

async function createIndexes(collection, definitions) {
  for (const definition of definitions) {
    const { key, name, unique, sparse } = definition;
    await collection.createIndex(key, {
      name,
      ...(unique ? { unique: true } : {}),
      ...(sparse ? { sparse: true } : {}),
    });
  }
}

await client.connect();
const database = client.db(databaseName);
await database.dropDatabase();

try {
  await createIndexes(
    database.collection('kairoseth_fiscal_records'),
    mongoFiscalRecordIndexes(),
  );
  await createIndexes(
    database.collection('kairoseth_api_records'),
    mongoIntegrationRecordIndexes(),
  );
  await createIndexes(
    database.collection('kairoseth_api_requests'),
    mongoIntegrationRequestIndexes(),
  );

  const fiscalStore = createMongoKairosethFiscalRecordStore({
    database,
    leaseMs: 10_000,
    leaseDelayMs: 5,
  });
  const integrationStore = createMongoKairosethIntegrationStore({
    database,
    reservationLeaseMs: 2_000,
  });
  const fiscalService = new FiscalRecordService({
    sif: {
      systemId: 'PV',
      installationNumber: '001',
      timeZone: 'Europe/Madrid',
    },
    store: fiscalStore,
    clock: () => new Date('2026-10-04T09:00:00Z'),
  });
  const bridge = new UniversalBridgeService({
    fiscalService,
    store: integrationStore,
  });
  const context = {
    organizationId: 'org-dataplane',
    installationId: 'install-dataplane',
    sourceSystem: 'api-smoke',
  };

  const [one, two] = await Promise.all([
    bridge.issue(invoice('mongo-1', '1'), context, { idempotencyKey: 'evt-1' }),
    bridge.issue(invoice('mongo-2', '2'), context, { idempotencyKey: 'evt-2' }),
  ]);
  assert.equal(one.duplicate, false);
  assert.equal(two.duplicate, false);

  const chainKey = one.fiscalRecord.chainKey;
  const chain = await fiscalStore.list(chainKey);
  assert.equal(chain.length, 2);
  assert.deepEqual(chain.map((record) => record.sequence), [1, 2]);
  assert.equal(chain[1].previous.hash, chain[0].hash);
  assert.equal(verifyFiscalChain(chain).ok, true);

  const retry = await bridge.issue(
    invoice('mongo-1', '1'),
    context,
    { idempotencyKey: 'evt-1' },
  );
  assert.equal(retry.duplicate, true);
  assert.equal(retry.recordId, one.recordId);

  await assert.rejects(
    bridge.issue(
      invoice('mongo-conflict', '9'),
      context,
      { idempotencyKey: 'evt-1' },
    ),
    { code: 'VF_API_IDEMPOTENCY_CONFLICT' },
  );

  const fetched = await bridge.get(one.recordId, context);
  assert.equal(fetched.recordId, one.recordId);
  await assert.rejects(
    bridge.get(one.recordId, {
      organizationId: 'org-other',
      installationId: 'install-other',
      sourceSystem: 'api-smoke',
    }),
    { code: 'VF_API_RECORD_NOT_FOUND' },
  );

  const cancellation = await bridge.cancel(
    one.recordId,
    { sourceCancellationId: 'cancel-mongo-1' },
    context,
    { idempotencyKey: 'cancel-evt-1' },
  );
  assert.equal(cancellation.fiscalRecord.recordType, 'anulacion');
  const chainAfterCancel = await fiscalStore.list(chainKey);
  assert.equal(chainAfterCancel.length, 3);
  assert.equal(chainAfterCancel[2].previous.hash, chainAfterCancel[1].hash);
  assert.equal(verifyFiscalChain(chainAfterCancel).ok, true);

  let now = 1_000;
  const leasedStore = createMongoKairosethIntegrationStore({
    database,
    recordsCollectionName: 'kairoseth_api_records_lease',
    requestsCollectionName: 'kairoseth_api_requests_lease',
    reservationLeaseMs: 500,
    clock: () => now,
  });
  await createIndexes(
    database.collection('kairoseth_api_records_lease'),
    mongoIntegrationRecordIndexes(),
  );
  await createIndexes(
    database.collection('kairoseth_api_requests_lease'),
    mongoIntegrationRequestIndexes(),
  );

  const payload = { invoice: 'lease-smoke' };
  const firstReservation = await leasedStore.reserve('lease-key', payload);
  assert.equal(firstReservation.duplicate, false);
  assert.match(firstReservation.reservationToken, /^ireq_/);

  const busyReservation = await leasedStore.reserve('lease-key', payload);
  assert.equal(busyReservation.duplicate, true);
  assert.equal(busyReservation.existing.recordId, null);

  now += 501;
  const reclaimed = await leasedStore.reserve('lease-key', payload);
  assert.equal(reclaimed.duplicate, false);
  assert.notEqual(reclaimed.reservationToken, firstReservation.reservationToken);

  await leasedStore.put({
    recordId: 'fr_lease_smoke',
    organizationId: 'org-dataplane',
    installationId: 'install-dataplane',
    fiscalRecord: chainAfterCancel[0],
  });
  await leasedStore.complete(
    'lease-key',
    payload,
    'fr_lease_smoke',
    reclaimed.reservationToken,
  );

  const completed = await leasedStore.reserve('lease-key', payload);
  assert.equal(completed.duplicate, true);
  assert.equal(completed.existing.recordId, 'fr_lease_smoke');

  console.log(JSON.stringify({
    schema_version: 1,
    status: 'ok',
    check: 'kairoseth-mongodb-dataplane',
    fiscal_chain_concurrency: true,
    fiscal_operation_idempotency: true,
    api_idempotency_recovery: true,
    tenant_isolation: true,
    cancellation_chain: true,
  }, null, 2));
} finally {
  await database.dropDatabase().catch(() => {});
  await client.close();
}
