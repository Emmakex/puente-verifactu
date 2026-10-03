import assert from 'node:assert/strict';
import pg from 'pg';
import { LocalAgentStore } from '../../packages/local-agent/src/store.mjs';
import { createPostgresReadOnlyDriver } from '../../packages/local-agent/src/postgres-driver.mjs';
import { pollDatabaseSource } from '../../packages/local-agent/src/database-source.mjs';

const host = process.env.PGHOST || '127.0.0.1';
const port = Number(process.env.PGPORT || 5432);
const database = process.env.PGDATABASE || 'puente';
const adminUser = process.env.PGUSER || 'postgres';
const adminPassword = process.env.PGPASSWORD || 'root';
const readerUser = 'pv_local_agent_reader';
const readerPassword = 'pv-local-agent-readonly-test';

const admin = new pg.Client({
  host,
  port,
  database,
  user: adminUser,
  password: adminPassword,
  ssl: false,
});

await admin.connect();

try {
  await admin.query('DROP TABLE IF EXISTS pv_local_agent_invoices');
  const staleRole = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [readerUser]);
  if (staleRole.rowCount > 0) {
    await admin.query(`DROP OWNED BY ${readerUser}`);
    await admin.query(`DROP ROLE ${readerUser}`);
  }
  await admin.query(`CREATE ROLE ${readerUser} LOGIN PASSWORD '${readerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
  await admin.query('CREATE TABLE pv_local_agent_invoices (id BIGINT PRIMARY KEY, invoice_no TEXT NOT NULL, total NUMERIC(12,2) NOT NULL)');
  await admin.query("INSERT INTO pv_local_agent_invoices (id, invoice_no, total) VALUES (1, 'F-1', 10.50), (2, 'F-2', 20.75), (3, 'F-3', 30.10)");
  await admin.query(`GRANT CONNECT ON DATABASE "${database.replaceAll('"', '""')}" TO ${readerUser}`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${readerUser}`);
  await admin.query(`GRANT SELECT ON TABLE pv_local_agent_invoices TO ${readerUser}`);

  const directReader = new pg.Client({
    host,
    port,
    database,
    user: readerUser,
    password: readerPassword,
    ssl: false,
  });
  await directReader.connect();
  try {
    await assert.rejects(
      () => directReader.query("INSERT INTO pv_local_agent_invoices (id, invoice_no, total) VALUES (9, 'NO', 1.00)"),
      (error) => error?.code === '42501',
    );
  } finally {
    await directReader.end();
  }

  const store = new LocalAgentStore(':memory:');
  try {
    const driver = createPostgresReadOnlyDriver({
      connection: {
        host,
        port,
        database,
        user: readerUser,
        password: readerPassword,
        ssl: false,
      },
      pgModule: pg,
      connectionTimeoutMs: 5_000,
      statementTimeoutMs: 5_000,
    });

    const first = await pollDatabaseSource({
      store,
      driver,
      sourceId: 'postgres-ci-invoices',
      profileId: 'postgres-ci-profile',
      cursorField: 'id',
      query: 'SELECT id, invoice_no, total FROM pv_local_agent_invoices WHERE ($1::bigint IS NULL OR id > $1) ORDER BY id ASC LIMIT $2',
      initialCursor: null,
      pageSize: 2,
      issueEnabled: true,
    });

    assert.equal(first.fetched, 2);
    assert.equal(first.queued, 2);
    assert.equal(first.checkpoint.cursor.value, '2');

    const second = await pollDatabaseSource({
      store,
      driver,
      sourceId: 'postgres-ci-invoices',
      profileId: 'postgres-ci-profile',
      cursorField: 'id',
      query: 'SELECT id, invoice_no, total FROM pv_local_agent_invoices WHERE ($1::bigint IS NULL OR id > $1) ORDER BY id ASC LIMIT $2',
      pageSize: 2,
      issueEnabled: true,
    });

    assert.equal(second.fetched, 1);
    assert.equal(second.queued, 1);
    assert.equal(second.checkpoint.cursor.value, '3');
    assert.equal(store.list().length, 3);

    console.log(JSON.stringify({
      status: 'ok',
      check: 'local-agent-postgresql-runtime',
      postgres_server_version: (await admin.query('SHOW server_version')).rows[0].server_version,
      rows_queued: store.list().length,
      read_only_role_enforced: true,
      transaction_read_only_enforced: true,
    }, null, 2));
  } finally {
    store.close();
  }
} finally {
  await admin.query('DROP TABLE IF EXISTS pv_local_agent_invoices');
  const existingRole = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [readerUser]);
  if (existingRole.rowCount > 0) {
    await admin.query(`DROP OWNED BY ${readerUser}`);
    await admin.query(`DROP ROLE ${readerUser}`);
  }
  await admin.end();
}
