import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresReadOnlyDriver } from '../src/postgres-driver.mjs';

function fakePg({ rows = [{ id: 2 }], readOnly = 'on', failConnect = null } = {}) {
  const instances = [];

  class Client {
    constructor(config) {
      this.config = config;
      this.queries = [];
      instances.push(this);
    }

    async connect() {
      if (failConnect) throw failConnect;
    }

    async query(input) {
      this.queries.push(input);
      const text = typeof input === 'string' ? input : input.text;
      if (text === 'SHOW transaction_read_only') {
        return { command: 'SHOW', rows: [{ transaction_read_only: readOnly }] };
      }
      if (/^SELECT\b/i.test(text)) {
        return { command: 'SELECT', rows };
      }
      return { command: text.split(/\s+/)[0].toUpperCase(), rows: [] };
    }

    async end() {}
  }

  return { module: { Client }, instances };
}

test('PostgreSQL driver verifies a read-only transaction before extraction', async () => {
  const pg = fakePg();
  const driver = createPostgresReadOnlyDriver({
    connection: {
      host: 'db.internal',
      port: 5432,
      database: 'erp',
      user: 'reader',
      password: 'secret',
      ssl: true,
    },
    pgModule: pg.module,
    statementTimeoutMs: 2_500,
  });

  assert.equal(driver.dialect, 'postgresql');
  assert.equal(driver.readOnly, true);
  assert.equal(await driver.assertReadOnly(), true);

  const verification = pg.instances[0].queries.map((entry) => typeof entry === 'string' ? entry : entry.text);
  assert.deepEqual(verification, [
    'BEGIN READ ONLY',
    "SET LOCAL statement_timeout = '2500ms'",
    'SHOW transaction_read_only',
    'ROLLBACK',
  ]);
});

test('PostgreSQL driver binds cursor and page limit without interpolating source values', async () => {
  const pg = fakePg({ rows: [{ id: 11, invoice: 'F-11' }, { id: 12, invoice: 'F-12' }] });
  const driver = createPostgresReadOnlyDriver({
    connectionString: 'postgresql://reader:secret@db.internal/erp',
    pgModule: pg.module,
  });

  const rows = await driver.fetchPage({
    query: 'SELECT id, invoice FROM invoices WHERE ($1::bigint IS NULL OR id > $1) ORDER BY id ASC LIMIT $2',
    cursor: 10,
    limit: 50,
  });

  assert.deepEqual(rows, [{ id: 11, invoice: 'F-11' }, { id: 12, invoice: 'F-12' }]);
  const query = pg.instances[0].queries.find((entry) => typeof entry === 'object');
  assert.equal(query.text, 'SELECT id, invoice FROM invoices WHERE ($1::bigint IS NULL OR id > $1) ORDER BY id ASC LIMIT $2');
  assert.deepEqual(query.values, [10, 50]);
  assert.ok(pg.instances[0].queries.includes('BEGIN READ ONLY'));
  assert.ok(pg.instances[0].queries.includes('COMMIT'));
});

test('PostgreSQL driver fails closed if transaction_read_only is not on', async () => {
  const pg = fakePg({ readOnly: 'off' });
  const driver = createPostgresReadOnlyDriver({
    connection: { host: 'localhost', database: 'erp', user: 'reader' },
    pgModule: pg.module,
  });

  assert.equal(await driver.assertReadOnly(), false);
});

test('PostgreSQL connection failures are normalized without leaking connection details', async () => {
  const error = Object.assign(new Error('connect ECONNREFUSED db.internal:5432'), { code: 'ECONNREFUSED' });
  const pg = fakePg({ failConnect: error });
  const driver = createPostgresReadOnlyDriver({
    connectionString: 'postgresql://reader:super-secret@db.internal/erp',
    pgModule: pg.module,
  });

  await assert.rejects(
    () => driver.assertReadOnly(),
    (failure) => {
      assert.equal(failure.code, 'VF_LOCAL_AGENT_POSTGRES_CONNECTION_FAILED');
      assert.equal(failure.retryable, true);
      assert.doesNotMatch(failure.message, /super-secret/);
      return true;
    },
  );
});

test('PostgreSQL runtime dependency is optional until the driver is instantiated for use', async () => {
  const driver = createPostgresReadOnlyDriver({
    connection: { host: 'localhost', database: 'erp', user: 'reader' },
    pgModule: {},
  });

  await assert.rejects(
    () => driver.assertReadOnly(),
    (error) => error.code === 'VF_LOCAL_AGENT_POSTGRES_CLIENT_INVALID',
  );
});
