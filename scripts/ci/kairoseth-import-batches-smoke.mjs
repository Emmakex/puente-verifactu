import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { hashBearerToken } from '../../apps/server/src/auth.mjs';
import { createPuenteRuntime } from '../../apps/server/src/runtime.mjs';
import {
  createMongoKairosethImportBatchStore,
  createMongoKairosethImportSessionStore,
  mongoImportBatchIndexes,
  mongoImportSessionIndexes,
} from '../../packages/kairoseth-control-plane/src/mongodb-import-batches.mjs';

const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018';
const client = new MongoClient(uri);
const databaseName = 'kairoseth_import_batches_smoke';
const sessionCollectionName = 'kairoseth_import_sessions_smoke';
const batchCollectionName = 'kairoseth_import_batches_smoke';

const token = 'kairoseth-import-smoke-primary';
const otherToken = 'kairoseth-import-smoke-other';

const csv = Buffer.from([
  'Nº Factura;Fecha factura;Concepto;Base imponible;Cuota IVA;Total factura',
  'A-9001;15/09/2026;Servicio Mongo;100,00;21,00;121,00',
].join('\n'));

const configuration = {
  'issuer.name': 'Empresa Demo',
  'issuer.taxId': 'TESTISSUER',
  currency: 'EUR',
  'taxBreakdown.0.taxCode': '01',
  'taxBreakdown.0.regimeKey': '01',
  'taxBreakdown.0.operationClass': 'S1',
  'taxBreakdown.0.rate': '21',
  invoiceType: 'F2',
};

function authConfig() {
  return {
    credentials: [
      {
        id: 'kairoseth-import-primary',
        type: 'bearer',
        tokenSha256: hashBearerToken(token),
        organizationId: 'org-import-001',
        installationId: 'install-import-01',
        sourceSystem: 'file-upload',
        rateLimitPerMinute: 1000,
        permissions: [],
      },
      {
        id: 'kairoseth-import-other',
        type: 'bearer',
        tokenSha256: hashBearerToken(otherToken),
        organizationId: 'org-import-other',
        installationId: 'install-import-other',
        sourceSystem: 'file-upload',
        rateLimitPerMinute: 1000,
        permissions: [],
      },
    ],
  };
}

async function createIndexes(database, collectionName, definitions) {
  const collection = database.collection(collectionName);
  for (const definition of definitions) {
    const { key, name, unique, expireAfterSeconds, partialFilterExpression } = definition;
    await collection.createIndex(key, {
      name,
      ...(unique ? { unique: true } : {}),
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

async function request(baseUrl, path, {
  method = 'GET',
  bearer = token,
  body = null,
  headers = {},
} = {}) {
  const requestHeaders = {
    authorization: `Bearer ${bearer}`,
    ...headers,
  };
  let payload = body;
  if (body && !Buffer.isBuffer(body) && typeof body !== 'string') {
    requestHeaders['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(baseUrl + path, {
    method,
    headers: requestHeaders,
    ...(payload == null ? {} : { body: payload }),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return { response, payload: parsed };
}

await client.connect();
const database = client.db(databaseName);
await database.dropDatabase();

try {
  await createIndexes(database, sessionCollectionName, mongoImportSessionIndexes());
  await createIndexes(database, batchCollectionName, mongoImportBatchIndexes());

  const createStores = () => ({
    importSessionStore: createMongoKairosethImportSessionStore({
      database,
      collectionName: sessionCollectionName,
    }),
    importBatchStore: createMongoKairosethImportBatchStore({
      database,
      collectionName: batchCollectionName,
    }),
  });

  const createRuntime = () => createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: {
      systemId: 'PV',
      installationNumber: '001',
      timeZone: 'Europe/Madrid',
    },
    ...createStores(),
  });

  const first = createRuntime();
  const firstUrl = await listen(first);

  const inspected = await request(firstUrl, '/v1/imports/inspect', {
    method: 'POST',
    body: csv,
    headers: {
      'x-file-name': encodeURIComponent('facturas.csv'),
      'accept-language': 'es',
    },
  });
  assert.equal(inspected.response.status, 201);
  assert.match(inspected.payload.importId, /^imp_[a-f0-9]{32}$/);

  const sessionDoc = await database.collection(sessionCollectionName).findOne({
    importId: inspected.payload.importId,
  });
  assert.ok(sessionDoc);
  assert.ok(sessionDoc.expiresAtDate instanceof Date);
  assert.equal(Buffer.isBuffer(sessionDoc.session), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sessionDoc.session, 'buffer'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sessionDoc.session, 'rawBody'), false);
  assert.equal(sessionDoc.session.organizationId, 'org-import-001');
  assert.equal(sessionDoc.session.installationId, 'install-import-01');

  const preflight = await request(
    firstUrl,
    `/v1/imports/${inspected.payload.importId}/preflight`,
    { method: 'POST', body: { configuration } },
  );
  assert.equal(preflight.response.status, 200);
  assert.equal(preflight.payload.ok, true);

  const confirmed = await request(
    firstUrl,
    `/v1/imports/${inspected.payload.importId}/confirm`,
    { method: 'POST', body: { configuration } },
  );
  assert.equal(confirmed.response.status, 201);
  assert.match(confirmed.payload.batchId, /^bat_[a-f0-9]{32}$/);
  assert.equal(confirmed.payload.summary.pending, 1);
  assert.equal('intent' in confirmed.payload.rows[0], false);

  const batchDoc = await database.collection(batchCollectionName).findOne({
    batchId: confirmed.payload.batchId,
  });
  assert.ok(batchDoc);
  assert.equal(batchDoc.organizationId, 'org-import-001');
  assert.equal(batchDoc.installationId, 'install-import-01');
  assert.equal(batchDoc.rows.length, 1);
  assert.equal(batchDoc.rows[0].intent.number, 'A-9001');
  assert.equal(Buffer.isBuffer(batchDoc.rows[0].intent), false);
  assert.equal(Object.prototype.hasOwnProperty.call(batchDoc, 'buffer'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(batchDoc, 'rawBody'), false);

  const repeated = await request(
    firstUrl,
    `/v1/imports/${inspected.payload.importId}/confirm`,
    { method: 'POST', body: { configuration } },
  );
  assert.equal(repeated.response.status, 201);
  assert.equal(repeated.payload.batchId, confirmed.payload.batchId);

  await first.close();

  const second = createRuntime();
  const secondUrl = await listen(second);
  try {
    const sessionAfterRestart = await request(
      secondUrl,
      `/v1/imports/${inspected.payload.importId}/preflight`,
      { method: 'POST', body: { configuration } },
    );
    assert.equal(sessionAfterRestart.response.status, 200);

    const batchAfterRestart = await request(
      secondUrl,
      `/v1/import-batches/${confirmed.payload.batchId}`,
    );
    assert.equal(batchAfterRestart.response.status, 200);
    assert.equal(batchAfterRestart.payload.batchId, confirmed.payload.batchId);

    const crossTenant = await request(
      secondUrl,
      `/v1/import-batches/${confirmed.payload.batchId}`,
      { bearer: otherToken },
    );
    assert.equal(crossTenant.response.status, 404);
    assert.equal(crossTenant.payload.error.code, 'VF_IMPORT_BATCH_NOT_FOUND');
  } finally {
    await second.close();
  }

  const sessionIndexes = await database.collection(sessionCollectionName).indexes();
  assert.ok(sessionIndexes.some((index) => (
    index.name === 'import_session_ttl'
    && index.expireAfterSeconds === 0
  )));
  assert.ok(sessionIndexes.some((index) => (
    index.name === 'import_session_tenant_import_unique'
    && index.unique
  )));

  const batchIndexes = await database.collection(batchCollectionName).indexes();
  assert.ok(batchIndexes.some((index) => (
    index.name === 'import_batch_tenant_batch_unique'
    && index.unique
  )));
  assert.ok(batchIndexes.some((index) => (
    index.name === 'import_batch_tenant_import_unique'
    && index.unique
  )));

  console.log(JSON.stringify({
    schema_version: 1,
    status: 'ok',
    check: 'kairoseth-import-batches-mongodb',
    session_ttl: true,
    batch_durable: true,
    tenant_isolation: true,
    runtime_restart_persistence: true,
    original_binary_persisted: false,
    frozen_invoice_intent: true,
  }, null, 2));
} finally {
  await database.dropDatabase().catch(() => {});
  await client.close();
}
