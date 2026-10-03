import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMysqlReadOnlyDriver,
  createPostgresReadOnlyDriver,
  createSqlServerReadOnlyDriver,
} from '../src/database-drivers.mjs';

test('PostgreSQL driver enforces read-only transaction for verification and fetch', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push([sql, params]);
      if (sql === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: 'on' }] };
      if (sql.startsWith('SELECT id')) return { rows: [{ id: '2' }] };
      return { rows: [] };
    },
    release() { calls.push(['release']); },
  };
  const pool = { async connect() { return client; } };
  const driver = createPostgresReadOnlyDriver({ pool });

  assert.equal(await driver.assertReadOnly(), true);
  const rows = await driver.fetchPage({
    query: 'SELECT id FROM invoices WHERE id > $1 LIMIT $2',
    cursor: '1',
    limit: 10,
  });

  assert.deepEqual(rows, [{ id: '2' }]);
  assert.equal(calls.filter(([sql]) => sql === 'BEGIN READ ONLY').length, 2);
  assert.equal(calls.filter(([sql]) => sql === 'ROLLBACK').length, 2);
});

test('MySQL/MariaDB driver enforces START TRANSACTION READ ONLY', async () => {
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(['query', sql]);
      if (sql === 'SELECT 1 AS ok') return [[{ ok: 1 }]];
      return [[]];
    },
    async execute(sql, params) {
      calls.push(['execute', sql, params]);
      return [[{ id: 2 }]];
    },
    async rollback() { calls.push(['rollback']); },
    release() { calls.push(['release']); },
  };
  const pool = { async getConnection() { return connection; } };
  const driver = createMysqlReadOnlyDriver({ pool, dialect: 'mariadb' });

  assert.equal(await driver.assertReadOnly(), true);
  const rows = await driver.fetchPage({
    query: 'SELECT id FROM invoices WHERE id > ? LIMIT ?',
    cursor: 1,
    limit: 10,
  });

  assert.deepEqual(rows, [{ id: 2 }]);
  assert.equal(
    calls.filter((entry) => entry[0] === 'query' && entry[1] === 'START TRANSACTION READ ONLY').length,
    2,
  );
  assert.equal(calls.filter(([kind]) => kind === 'rollback').length, 2);
});

test('SQL Server driver rejects write-capable principal and binds cursor/limit', async () => {
  const inputs = [];
  let readOnly = true;
  const pool = {
    request() {
      const requestInputs = {};
      return {
        input(name, value) {
          requestInputs[name] = value;
          inputs.push([name, value]);
          return this;
        },
        async query(sql) {
          if (sql.includes('write_grants')) {
            return { recordset: [{ read_only: readOnly, can_select: true }] };
          }
          assert.equal(requestInputs.cursor, 4);
          assert.equal(requestInputs.limit, 25);
          return { recordset: [{ id: 5 }] };
        },
      };
    },
  };

  const driver = createSqlServerReadOnlyDriver({ pool });
  assert.equal(await driver.assertReadOnly(), true);
  assert.deepEqual(await driver.fetchPage({
    query: 'SELECT TOP (@limit) id FROM invoices WHERE id > @cursor ORDER BY id',
    cursor: 4,
    limit: 25,
  }), [{ id: 5 }]);
  assert.deepEqual(inputs, [['cursor', 4], ['limit', 25]]);

  readOnly = false;
  await assert.rejects(
    () => driver.assertReadOnly(),
    (error) => error.code === 'VF_LOCAL_AGENT_DB_READ_ONLY_REQUIRED',
  );
});
