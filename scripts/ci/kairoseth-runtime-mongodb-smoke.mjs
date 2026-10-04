import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { hashBearerToken } from '../../apps/server/src/auth.mjs';
import { createPuenteRuntime } from '../../apps/server/src/runtime.mjs';
import { AeatOutboxWorker } from '../../packages/aeat-adapter/src/outbox.mjs';
import {
  createMongoKairosethAeatOutboxStore,
  createMongoKairosethFiscalRecordStore,
  createMongoKairosethImportBatchStore,
  createMongoKairosethImportSessionStore,
  createMongoKairosethIntegrationStore,
  createMongoKairosethIntegrationProfileStore,
  createMongoKairosethLocalAgentRegistryStore,
  createMongoKairosethOnboardingProfileStore,
  mongoAeatOutboxIndexes,
  mongoFiscalRecordIndexes,
  mongoImportBatchIndexes,
  mongoImportSessionIndexes,
  mongoIntegrationRecordIndexes,
  mongoIntegrationRequestIndexes,
  mongoIntegrationProfileIndexes,
  mongoLocalAgentRegistryIndexes,
  mongoOnboardingProfileIndexes,
} from '../../packages/kairoseth-control-plane/src/index.mjs';

const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018';
const client = new MongoClient(uri);
const databaseName = 'kairoseth_runtime_mongodb_smoke';
const dataToken = 'kairoseth-runtime-data';
const opsToken = 'kairoseth-runtime-ops';

function authConfig() {
  return {
    credentials: [
      {
        id: 'runtime-data',
        type: 'bearer',
        tokenSha256: hashBearerToken(dataToken),
        organizationId: 'org-runtime-mongo',
        installationId: 'install-runtime-mongo',
        sourceSystem: 'api-runtime-mongo',
        rateLimitPerMinute: 1000,
        permissions: [],
      },
      {
        id: 'runtime-ops',
        type: 'bearer',
        tokenSha256: hashBearerToken(opsToken),
        organizationId: 'org-runtime-mongo',
        installationId: 'ops-runtime-mongo',
        sourceSystem: 'kairoseth-platform',
        rateLimitPerMinute: 1000,
        permissions: ['ops:read'],
      },
    ],
  };
}

function intent() {
  return {
    sourceInvoiceId: 'MONGO-RUNTIME-1',
    series: 'MR-',
    number: '1',
    issueDate: '2026-10-04',
    invoiceType: 'F2',
    description: 'Runtime Mongo smoke',
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
    const {
      key,
      name,
      unique,
      sparse,
      expireAfterSeconds,
      partialFilterExpression,
    } = definition;
    await collection.createIndex(key, {
      name,
      ...(unique ? { unique: true } : {}),
      ...(sparse ? { sparse: true } : {}),
      ...(expireAfterSeconds != null ? { expireAfterSeconds } : {}),
      ...(partialFilterExpression ? { partialFilterExpression } : {}),
    });
  }
}

async function listen(runtime) {
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(0, '127.0.0.1', () => {
      runtime.server.off('error', reject);
      resolve();
    });
  });
  const address = runtime.server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function jsonRequest(baseUrl, path, {
  method = 'GET',
  token = dataToken,
  body = null,
} = {}) {
  const headers = {
    authorization: `Bearer ${token}`,
  };
  if (body != null) headers['content-type'] = 'application/json';
  const response = await fetch(baseUrl + path, {
    method,
    headers,
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    response,
    payload: text ? JSON.parse(text) : null,
  };
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
  await createIndexes(
    database.collection('kairoseth_import_sessions'),
    mongoImportSessionIndexes(),
  );
  await createIndexes(
    database.collection('kairoseth_import_batches'),
    mongoImportBatchIndexes(),
  );
  await createIndexes(
    database.collection('kairoseth_local_agent_installations'),
    mongoLocalAgentRegistryIndexes(),
  );
  await createIndexes(
    database.collection('kairoseth_onboarding_profiles'),
    mongoOnboardingProfileIndexes(),
  );
  await createIndexes(
    database.collection('kairoseth_integration_profiles'),
    mongoIntegrationProfileIndexes(),
  );
  await createIndexes(
    database.collection('kairoseth_aeat_outbox'),
    mongoAeatOutboxIndexes(),
  );

  const aeatOutboxForWorker = createMongoKairosethAeatOutboxStore({ database });
  await aeatOutboxForWorker.enqueue(
    {
      issuer: { name: 'Empresa Demo', taxId: '89890001K' },
      entries: [{ recordId: 'runtime-aeat-smoke' }],
    },
    {
      id: 'aeat_runtime_accepted',
      availableAt: 1000,
      now: 1000,
    },
  );
  let aeatCalls = 0;
  const worker = new AeatOutboxWorker({
    outbox: aeatOutboxForWorker,
    adapter: {
      async submit() {
        aeatCalls += 1;
        return {
          kind: 'aeat_response',
          status: 'accepted',
          retryable: false,
          records: [{ status: 'accepted' }],
        };
      },
    },
    clock: () => 1000,
    workerId: 'runtime-mongo-worker',
  });
  const dispatched = await worker.run('aeat_runtime_accepted');
  assert.equal(dispatched.state, 'completed');
  assert.equal(dispatched.attempts, 1);
  assert.equal(aeatCalls, 1);

  await aeatOutboxForWorker.enqueue(
    { entries: [{ recordId: 'uncertain-runtime-smoke' }] },
    { id: 'aeat_runtime_expired', availableAt: 0, now: 0 },
  );
  const claimed = await aeatOutboxForWorker.claim(
    'aeat_runtime_expired',
    { owner: 'dead-worker', now: 0, leaseMs: 100 },
  );
  assert.equal(claimed.state, 'processing');
  assert.equal(await aeatOutboxForWorker.recoverExpired(101), 1);
  const quarantined = await aeatOutboxForWorker.get('aeat_runtime_expired');
  assert.equal(quarantined.state, 'reconciliation_required');
  assert.equal(
    quarantined.lastResult.reason,
    'lease_expired_after_dispatch_start',
  );
  const quarantinedStats = await aeatOutboxForWorker.stats(101);
  assert.equal(quarantinedStats.reconciliationRequired, 1);

  const reconciled = await aeatOutboxForWorker.resolveReconciliation(
    'aeat_runtime_expired',
    {
      action: 'complete',
      result: {
        kind: 'manual_reconciliation',
        action: 'complete',
        outcome: 'verified_not_pending',
      },
      now: 102,
    },
  );
  assert.equal(reconciled.state, 'completed');
  assert.equal((await aeatOutboxForWorker.stats(102)).reconciliationRequired, 0);

  const stores = () => {
    const fiscalRecordStore = createMongoKairosethFiscalRecordStore({ database });
    return {
      fiscalRecordStore,
      integrationDataStore: createMongoKairosethIntegrationStore({ database }),
      importSessionStore: createMongoKairosethImportSessionStore({ database }),
      importBatchStore: createMongoKairosethImportBatchStore({ database }),
      localAgentRegistryStore: createMongoKairosethLocalAgentRegistryStore({ database }),
      onboardingProfileStore: createMongoKairosethOnboardingProfileStore({ database }),
      integrationProfileStore: createMongoKairosethIntegrationProfileStore({ database }),
      aeatOutboxStore: createMongoKairosethAeatOutboxStore({ database }),
      resolveIntegrationSecretReference: async () => null,
      kairosethAuthProvider: {
        async resolveBearerDigest() { return null; },
      },
      persistenceHealthcheck: () => fiscalRecordStore.healthcheck(),
    };
  };

  const backupStatusProvider = async () => ({
    configured: true,
    status: 'ok',
    createdAt: '2026-10-04T09:00:00.000Z',
    ageMs: 60_000,
    provider: 'kairoseth-managed-mongodb-backup',
  });

  const createRuntime = () => createPuenteRuntime({
    persistenceMode: 'kairoseth',
    authConfig: authConfig(),
    sif: {
      systemId: 'PV',
      installationNumber: '001',
      timeZone: 'Europe/Madrid',
    },
    observabilityClock: () => Date.parse('2026-10-04T09:01:00.000Z'),
    backupStatusProvider,
    ...stores(),
  });

  const first = createRuntime();
  assert.equal(first.persistenceMode, 'kairoseth');
  assert.equal(first.persistence.database, null);
  assert.equal(first.recoveredReservations, 0);
  const firstUrl = await listen(first);

  const ready = await fetch(firstUrl + '/readyz');
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).status, 'ready');

  const created = await jsonRequest(firstUrl, '/v1/fiscal-records', {
    method: 'POST',
    body: { intent: intent() },
  });
  // Add Idempotency-Key separately because helper intentionally keeps headers minimal.
  assert.equal(created.response.status, 400);
  assert.equal(created.payload.error.code, 'VF_API_IDEMPOTENCY_KEY_REQUIRED');

  const issueResponse = await fetch(firstUrl + '/v1/fiscal-records', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${dataToken}`,
      'content-type': 'application/json',
      'idempotency-key': 'runtime-mongo-evt-1',
    },
    body: JSON.stringify({ intent: intent() }),
  });
  assert.equal(issueResponse.status, 202);
  const issued = await issueResponse.json();
  assert.match(issued.recordId, /^fr_[a-f0-9]{24}$/);

  const ops = await jsonRequest(firstUrl, '/v1/ops/status', {
    token: opsToken,
  });
  assert.equal(ops.response.status, 200);
  assert.equal(ops.payload.mode, 'kairoseth-mongodb');
  assert.equal(ops.payload.database.ok, true);
  assert.equal(ops.payload.aeatOutbox.available, true);
  assert.equal(ops.payload.backup.status, 'ok');
  assert.equal(ops.payload.summary.status, 'ok');

  await first.close();

  const second = createRuntime();
  const secondUrl = await listen(second);
  try {
    const retryResponse = await fetch(secondUrl + '/v1/fiscal-records', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${dataToken}`,
        'content-type': 'application/json',
        'idempotency-key': 'runtime-mongo-evt-1',
      },
      body: JSON.stringify({ intent: intent() }),
    });
    assert.equal(retryResponse.status, 200);
    const retry = await retryResponse.json();
    assert.equal(retry.recordId, issued.recordId);
    assert.equal(retry.duplicate, true);

    const fetched = await jsonRequest(
      secondUrl,
      '/v1/fiscal-records/' + issued.recordId,
    );
    assert.equal(fetched.response.status, 200);
    assert.equal(fetched.payload.recordId, issued.recordId);

    const readyAfterRestart = await fetch(secondUrl + '/readyz');
    assert.equal(readyAfterRestart.status, 200);

    const opsAfterRestart = await jsonRequest(secondUrl, '/v1/ops/status', {
      token: opsToken,
    });
    assert.equal(opsAfterRestart.response.status, 200);
    assert.equal(opsAfterRestart.payload.mode, 'kairoseth-mongodb');
  } finally {
    await second.close();
  }

  assert.equal(
    await database.collection('kairoseth_fiscal_records').countDocuments({}),
    1,
  );
  assert.equal(
    await database.collection('kairoseth_api_records').countDocuments({}),
    1,
  );

  console.log(JSON.stringify({
    schema_version: 1,
    status: 'ok',
    check: 'kairoseth-mongodb-runtime-without-sqlite',
    sqlite_required: false,
    restart_idempotency: true,
    readiness: true,
    observability: true,
    managed_backup_status: true,
    onboarding_profiles_mongodb: true,
    integration_profiles_mongodb: true,
    kairoseth_auth_injected: true,
    aeat_outbox_dispatch: true,
    aeat_expired_lease_quarantine: true,
  }, null, 2));
} finally {
  await database.dropDatabase().catch(() => {});
  await client.close();
}
