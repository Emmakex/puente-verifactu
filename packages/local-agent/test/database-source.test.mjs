import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAgentStore } from '../src/store.mjs';
import {
  assertReadOnlySelect,
  createReadOnlyDatabaseDriver,
  pollDatabaseSource,
} from '../src/database-source.mjs';

test('database source SQL guard accepts one SELECT and rejects write-capable statements', () => {
  assert.equal(
    assertReadOnlySelect('SELECT id, total FROM invoices WHERE id > ? ORDER BY id ASC;'),
    'SELECT id, total FROM invoices WHERE id > ? ORDER BY id ASC',
  );

  for (const query of [
    'UPDATE invoices SET total = 0',
    'SELECT * INTO backup_invoices FROM invoices',
    'SELECT * FROM invoices; DELETE FROM invoices',
    'SELECT * FROM invoices -- unsafe trailing text',
    'WITH rows AS (SELECT * FROM invoices) SELECT * FROM rows',
  ]) {
    assert.throws(
      () => assertReadOnlySelect(query),
      (error) => error.code === 'VF_LOCAL_AGENT_DB_QUERY_UNSAFE',
      query,
    );
  }
});

test('database polling is fail-closed until issue is explicitly enabled', async () => {
  const store = new LocalAgentStore(':memory:');
  let touched = false;
  const driver = createReadOnlyDatabaseDriver({
    dialect: 'postgresql',
    verifyReadOnly: async () => { touched = true; return true; },
    fetchPage: async () => [],
  });

  await assert.rejects(
    () => pollDatabaseSource({
      store,
      driver,
      sourceId: 'erp-db',
      profileId: 'erp-profile',
      cursorField: 'id',
      query: 'SELECT id FROM invoices WHERE id > $1 ORDER BY id LIMIT $2',
    }),
    (error) => error.code === 'VF_LOCAL_AGENT_DB_ISSUE_DISABLED',
  );
  assert.equal(touched, false);
  store.close();
});

test('database polling queues mapped-source rows and advances durable checkpoint after enqueue', async () => {
  const store = new LocalAgentStore(':memory:');
  const calls = [];
  let clock = 1_000;
  const driver = createReadOnlyDatabaseDriver({
    dialect: 'mysql',
    verifyReadOnly: async () => true,
    fetchPage: async (context) => {
      calls.push(context);
      return [
        { id: 101n, invoice: 'F-101', total: '12.10' },
        { id: 102n, invoice: 'F-102', total: '14.20' },
      ];
    },
  });

  const result = await pollDatabaseSource({
    store,
    driver,
    sourceId: 'legacy-invoices',
    profileId: 'legacy-profile',
    cursorField: 'id',
    query: 'SELECT id, invoice, total FROM invoices WHERE id > ? ORDER BY id ASC LIMIT ?',
    initialCursor: '100',
    pageSize: 25,
    issueEnabled: true,
    now: () => clock++,
  });

  assert.equal(result.fetched, 2);
  assert.equal(result.queued, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cursor, '100');
  assert.equal(calls[0].limit, 25);

  const jobs = store.list();
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].payload.kind, 'mapped-source');
  assert.equal(jobs[0].payload.profileId, 'legacy-profile');
  assert.equal(jobs[0].payload.source.id, '101');
  assert.deepEqual(store.getCheckpoint('legacy-invoices').cursor, {
    cursorField: 'id',
    value: '102',
  });

  const duplicatePage = createReadOnlyDatabaseDriver({
    dialect: 'mysql',
    verifyReadOnly: async () => true,
    fetchPage: async () => [
      { id: 101n, invoice: 'F-101', total: '12.10' },
      { id: 102n, invoice: 'F-102', total: '14.20' },
    ],
  });
  await pollDatabaseSource({
    store,
    driver: duplicatePage,
    sourceId: 'legacy-invoices',
    profileId: 'legacy-profile',
    cursorField: 'id',
    query: 'SELECT id, invoice, total FROM invoices WHERE id > ? ORDER BY id ASC LIMIT ?',
    issueEnabled: true,
  });
  assert.equal(store.list().length, 2);
  store.close();
});

test('database checkpoint does not advance when a page cannot be durably enqueued', async () => {
  const store = new LocalAgentStore(':memory:');
  const driver = createReadOnlyDatabaseDriver({
    dialect: 'sqlserver',
    verifyReadOnly: async () => true,
    fetchPage: async () => [
      { id: 7, invoice: 'A' },
      { id: 7, invoice: 'B' },
    ],
  });

  await assert.rejects(
    () => pollDatabaseSource({
      store,
      driver,
      sourceId: 'sqlserver-invoices',
      profileId: 'sqlserver-profile',
      cursorField: 'id',
      query: 'SELECT TOP (@limit) id, invoice FROM invoices WHERE id > @cursor ORDER BY id ASC',
      issueEnabled: true,
    }),
    (error) => error.code === 'VF_LOCAL_AGENT_DB_CURSOR_DUPLICATE',
  );

  assert.equal(store.getCheckpoint('sqlserver-invoices'), null);
  assert.equal(store.list().length, 1);
  store.close();
});

test('database driver must verify read-only credentials/session before extraction', async () => {
  const store = new LocalAgentStore(':memory:');
  const driver = createReadOnlyDatabaseDriver({
    dialect: 'mariadb',
    verifyReadOnly: async () => false,
    fetchPage: async () => {
      throw new Error('must not execute');
    },
  });

  await assert.rejects(
    () => pollDatabaseSource({
      store,
      driver,
      sourceId: 'maria-invoices',
      profileId: 'maria-profile',
      cursorField: 'id',
      query: 'SELECT id FROM invoices WHERE id > ? ORDER BY id ASC LIMIT ?',
      issueEnabled: true,
    }),
    (error) => error.code === 'VF_LOCAL_AGENT_DB_READ_ONLY_REQUIRED',
  );
  assert.equal(store.list().length, 0);
  store.close();
});
