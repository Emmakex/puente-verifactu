import assert from 'node:assert/strict';
import { LocalAgentStore } from '../../packages/local-agent/src/store.mjs';
import { pollDatabaseSource } from '../../packages/local-agent/src/database-source.mjs';
import {
  createMysqlReadOnlyDriver,
  createPostgresReadOnlyDriver,
  createSqlServerReadOnlyDriver,
} from '../../packages/local-agent/src/database-drivers.mjs';

const dialect = String(process.env.DB_DIALECT ?? '').trim().toLowerCase();
const host = process.env.DB_HOST ?? '127.0.0.1';
const port = Number(process.env.DB_PORT || 0);

async function smokePostgres() {
  const pg = await import('pg');
  const admin = new pg.Pool({
    host,
    port: port || 5432,
    user: 'postgres',
    password: 'root',
    database: 'postgres',
  });

  try {
    await admin.query('DROP TABLE IF EXISTS pv_invoices');
    await admin.query("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pvreader') THEN DROP ROLE pvreader; END IF; END $$");
    await admin.query('CREATE TABLE pv_invoices (id BIGINT PRIMARY KEY, invoice_number TEXT NOT NULL, total NUMERIC(12,2) NOT NULL)');
    await admin.query("INSERT INTO pv_invoices VALUES (1, 'PG-1', 10.10), (2, 'PG-2', 20.20)");
    await admin.query("CREATE ROLE pvreader LOGIN PASSWORD 'pvreader-pass'");
    await admin.query('GRANT USAGE ON SCHEMA public TO pvreader');
    await admin.query('GRANT SELECT ON TABLE pv_invoices TO pvreader');

    const reader = new pg.Pool({
      host,
      port: port || 5432,
      user: 'pvreader',
      password: 'pvreader-pass',
      database: 'postgres',
    });
    try {
      const driver = createPostgresReadOnlyDriver({ pool: reader });
      const store = new LocalAgentStore(':memory:');
      const result = await pollDatabaseSource({
        store,
        driver,
        sourceId: 'postgres-smoke',
        profileId: 'postgres-profile',
        cursorField: 'id',
        query: 'SELECT id, invoice_number, total FROM pv_invoices WHERE id > $1 ORDER BY id ASC LIMIT $2',
        initialCursor: '0',
        issueEnabled: true,
      });
      assert.equal(result.fetched, 2);
      assert.equal(store.list().length, 2);
      assert.equal(String(store.getCheckpoint('postgres-smoke').cursor.value), '2');
      await assert.rejects(() => reader.query("INSERT INTO pv_invoices VALUES (3, 'NO', 30.30)"));
      store.close();
    } finally {
      await reader.end();
    }
  } finally {
    await admin.end();
  }
}

async function smokeMysql(mysqlDialect) {
  const mysql = await import('mysql2/promise');
  const admin = mysql.createPool({
    host,
    port: port || 3306,
    user: 'root',
    password: 'root',
    multipleStatements: false,
  });

  try {
    await admin.query('CREATE DATABASE IF NOT EXISTS pvtest');
    await admin.query('DROP TABLE IF EXISTS pvtest.pv_invoices');
    await admin.query('CREATE TABLE pvtest.pv_invoices (id BIGINT PRIMARY KEY, invoice_number VARCHAR(50) NOT NULL, total DECIMAL(12,2) NOT NULL)');
    await admin.query("INSERT INTO pvtest.pv_invoices VALUES (1, 'MY-1', 10.10), (2, 'MY-2', 20.20)");
    await admin.query("DROP USER IF EXISTS 'pvreader'@'%'");
    await admin.query("CREATE USER 'pvreader'@'%' IDENTIFIED BY 'pvreader-pass'");
    await admin.query("GRANT SELECT ON pvtest.* TO 'pvreader'@'%'");
    await admin.query('FLUSH PRIVILEGES');

    const reader = mysql.createPool({
      host,
      port: port || 3306,
      user: 'pvreader',
      password: 'pvreader-pass',
      database: 'pvtest',
    });

    try {
      const driver = createMysqlReadOnlyDriver({ pool: reader, dialect: mysqlDialect });
      const store = new LocalAgentStore(':memory:');
      const result = await pollDatabaseSource({
        store,
        driver,
        sourceId: `${mysqlDialect}-smoke`,
        profileId: `${mysqlDialect}-profile`,
        cursorField: 'id',
        query: 'SELECT id, invoice_number, total FROM pv_invoices WHERE id > ? ORDER BY id ASC LIMIT ?',
        initialCursor: '0',
        issueEnabled: true,
      });
      assert.equal(result.fetched, 2);
      assert.equal(store.list().length, 2);
      assert.equal(String(store.getCheckpoint(`${mysqlDialect}-smoke`).cursor.value), '2');
      await assert.rejects(() => reader.query("INSERT INTO pv_invoices VALUES (3, 'NO', 30.30)"));
      store.close();
    } finally {
      await reader.end();
    }
  } finally {
    await admin.end();
  }
}

async function smokeSqlServer() {
  const imported = await import('mssql');
  const sql = imported.default ?? imported;
  const baseConfig = {
    server: host,
    port: port || 1433,
    user: 'sa',
    password: 'Puente!Test2026',
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
    pool: { max: 2, min: 0 },
  };

  const master = await new sql.ConnectionPool({ ...baseConfig, database: 'master' }).connect();
  try {
    await master.request().query("IF DB_ID('pvtest') IS NULL CREATE DATABASE pvtest");
    await master.request().query("IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'pvreader') DROP LOGIN pvreader");
    await master.request().query("CREATE LOGIN pvreader WITH PASSWORD = 'Kf9!Zq2#Lm7@'");
  } finally {
    await master.close();
  }

  const admin = await new sql.ConnectionPool({ ...baseConfig, database: 'pvtest' }).connect();
  try {
    await admin.request().query("IF OBJECT_ID('dbo.pv_invoices', 'U') IS NOT NULL DROP TABLE dbo.pv_invoices");
    await admin.request().query('CREATE TABLE dbo.pv_invoices (id BIGINT PRIMARY KEY, invoice_number NVARCHAR(50) NOT NULL, total DECIMAL(12,2) NOT NULL)');
    await admin.request().query("INSERT INTO dbo.pv_invoices VALUES (1, 'MS-1', 10.10), (2, 'MS-2', 20.20)");
    await admin.request().query("IF USER_ID('pvreader') IS NOT NULL DROP USER pvreader");
    await admin.request().query('CREATE USER pvreader FOR LOGIN pvreader');
    await admin.request().query('ALTER ROLE db_datareader ADD MEMBER pvreader');
    await admin.request().query('DENY INSERT, UPDATE, DELETE ON DATABASE::pvtest TO pvreader');
  } finally {
    await admin.close();
  }

  const reader = await new sql.ConnectionPool({
    ...baseConfig,
    database: 'pvtest',
    user: 'pvreader',
    password: 'Kf9!Zq2#Lm7@',
  }).connect();

  try {
    const driver = createSqlServerReadOnlyDriver({ pool: reader });
    const store = new LocalAgentStore(':memory:');
    const result = await pollDatabaseSource({
      store,
      driver,
      sourceId: 'sqlserver-smoke',
      profileId: 'sqlserver-profile',
      cursorField: 'id',
      query: 'SELECT TOP (@limit) id, invoice_number, total FROM dbo.pv_invoices WHERE id > @cursor ORDER BY id ASC',
      initialCursor: 0,
      issueEnabled: true,
    });
    assert.equal(result.fetched, 2);
    assert.equal(store.list().length, 2);
    assert.equal(String(store.getCheckpoint('sqlserver-smoke').cursor.value), '2');
    await assert.rejects(() => reader.request().query("INSERT INTO dbo.pv_invoices VALUES (3, 'NO', 30.30)"));
    store.close();
  } finally {
    await reader.close();
  }
}

if (dialect === 'postgresql') {
  await smokePostgres();
} else if (dialect === 'mysql' || dialect === 'mariadb') {
  await smokeMysql(dialect);
} else if (dialect === 'sqlserver') {
  await smokeSqlServer();
} else {
  throw new Error(`Unsupported DB_DIALECT for smoke: ${dialect}`);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'local-agent-database-runtime',
  dialect,
  read_only_source: true,
  durable_checkpoint: true,
  mapped_source_queue: true,
}, null, 2));
