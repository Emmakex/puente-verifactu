# Local Agent v1

Foundation for the local/offline integration channel of **Kairoseth Extensions → Puente VeriFactu**.

## Purpose

The Local Agent is for ERP, POS, desktop software and local-network systems that cannot reliably integrate through a native plugin or direct server-to-server API.

It is intentionally **not** a fiscal engine. The agent moves source data toward Puente and keeps a durable local queue. AEAT rules, certificates, tenant authority, mapping authority and the fiscal record lifecycle remain on the Puente/Kairoseth server.

## Foundation included

- SQLite local store using Node 22 `node:sqlite`, with database file hardened to `0600` on POSIX;
- durable queue;
- stable idempotency key derived from `sourceId + sourceKey`;
- worker leases;
- crash recovery;
- retry with bounded exponential backoff;
- blocked state for non-retryable failures;
- durable source checkpoints;
- deterministic CSV/XLSX watch-folder discovery with streamed SHA-256 hashing;
- outbound HTTPS policy;
- adapter manifest bound to `kairoseth/extensions/puente-verifactu`.

## Safety model

### No inbound network listener

The foundation opens no inbound HTTP port. The intended architecture is outbound-only toward Kairoseth/Puente. `createLocalAgentApiClient()` rejects non-HTTPS remote URLs; insecure HTTP is accepted only for explicit localhost development.

### Fiscal secrets stay server-side

The Local Agent manifest requires:

- `secrets_server_side=true`;
- `aeat_certificate_server_side=true`;
- `tenant_server_authoritative=true`.

Do not copy an AEAT certificate, PFX passphrase, private key or fiscal signing material into the agent.

### Idempotent recovery

A source operation has a stable `sourceId + sourceKey`. The agent derives one stable `Idempotency-Key`, so a crash or lost HTTP response can safely retry against the Puente API without inventing a second operation.

### Read-only source strategy

Generic database extraction now has a fail-closed read-only contract. The Local Agent accepts only a verified read-only driver, only a single `SELECT` statement, and rejects write-capable SQL constructs before touching the source.

The application-side guard is defense in depth, not a substitute for database permissions. Production database credentials must be provisioned as **SELECT-only**. The foundation continues to declare `source_read_only=true`.

## Queue payloads

The generic worker currently supports two API payload kinds through `createPuenteApiTransport()`:

```js
{
  kind: 'invoice-intent',
  intent: { /* InvoiceIntent v1 */ }
}
```

or:

```js
{
  kind: 'mapped-source',
  profileId: 'erp-profile',
  source: { /* source system row/event */ }
}
```

Both routes run preflight before issue.

## Watch folder

`scanWatchFolder()` detects `.csv` and `.xlsx` files and calculates a SHA-256 fingerprint. The queue key contains filename + content hash, so:

- the same unchanged file is queued once;
- changing file contents creates a new source revision;
- unrelated extensions are ignored.

The watch-folder ingest layer now stages stable CSV/XLSX files, parses them with the existing read-only file connector, fans rows out as durable `mapped-source` jobs, runs the server-side MappingProfile through preflight before issue, and archives the original source file only after all row jobs reach a terminal state.

Issuance is fail-closed by default: `ingestWatchFolder()` refuses to move or enqueue files unless `issueEnabled=true` is explicitly configured.

Folder lifecycle:

```text
inbox/
  -> processing/
       -> row jobs -> server preflight -> issue
       -> completed batch -> processed/
       -> blocked batch   -> error/
```

The processing manifest stores only batch/job identifiers and file metadata, not raw row contents. Raw source rows live in the local SQLite queue while they are needed for delivery.

After a watch-folder batch reaches `processed/` or `error/`, its terminal queue rows are **redacted automatically**:

- raw `payload_json` becomes `null`;
- server response bodies are removed from `result_json`;
- blocked errors keep only `code`, `status` and `retryable`;
- `sourceId`, `sourceKey`, payload fingerprint, stable Idempotency-Key, terminal state and `recordId` remain.

That retained metadata is enough to reject a conflicting replay and to recognize an identical source operation without keeping the original row data indefinitely.

`store.redactTerminalPayloads()` is also available as a maintenance sweep for terminal jobs left behind by a crash between archive and redaction.

The original CSV/XLSX archived under `processed/` or `error/` is **not deleted automatically**. Source-file retention is an operator policy and must not be confused with SQLite payload minimization.

## Database source

`pollDatabaseSource()` provides the shared extraction path for PostgreSQL, MySQL/MariaDB and SQL Server drivers without embedding fiscal rules in the database integration.

The source contract requires:

- a verified read-only driver;
- an explicit `issueEnabled=true` opt-in;
- exactly one `SELECT` query;
- a stable cursor column;
- bounded pages of at most 1,000 rows;
- server-side `MappingProfile` through the existing `mapped-source` payload;
- durable queue insertion before checkpoint advancement.

Example:

```js
const driver = createPostgresReadOnlyDriver({
  connection: {
    host: '127.0.0.1',
    database: 'erp',
    user: 'puente_reader',
    password: process.env.PV_DB_PASSWORD,
    ssl: false,
  },
});

await pollDatabaseSource({
  store,
  driver,
  sourceId: 'erp-invoices',
  profileId: 'erp-invoices-v1',
  cursorField: 'id',
  query: 'SELECT id, number, total FROM invoices WHERE id > $1 ORDER BY id ASC LIMIT $2',
  issueEnabled: true,
});
```

Each row becomes one durable `mapped-source` job. The source key is derived from the cursor value, so a crash between queueing and checkpoint persistence can replay extraction without creating a second fiscal operation.

The checkpoint is **transport/source progress only**. It is not a fiscal record and never replaces server-side idempotency.

### PostgreSQL runtime driver

`createPostgresReadOnlyDriver()` is the first vendor runtime implementation. It keeps `pg` optional so the core repository and ecommerce connectors do not inherit a database client they do not use.

The PostgreSQL driver:

- opens a fresh outbound database connection per verification/page operation;
- starts every verification and extraction inside `BEGIN READ ONLY`;
- verifies `transaction_read_only=on` before the generic source contract accepts it;
- applies a bounded `statement_timeout`;
- binds cursor and page size as PostgreSQL parameters (`$1`, `$2`) rather than interpolating source values;
- closes the client in success and failure paths;
- normalizes connection failures without including credentials in the public error message.

Production should still use a dedicated database account with only `CONNECT`, schema `USAGE`, and `SELECT` on the required views/tables. Transaction-level read-only is an additional enforcement layer, not a reason to grant write privileges.

The repository does not install `pg` globally. PostgreSQL deployments install `pg@8` alongside the Local Agent. CI installs it only inside the PostgreSQL compatibility job.

Compatibility evidence is executed against real PostgreSQL 14, 16 and 18 service containers. MySQL/MariaDB and SQL Server remain separate compatibility units until their runtime drivers and CI matrices land.

## Gate

```bash
npm run local-agent:smoke
npm run local-agent:contract
npm run local-agent:postgres:smoke # requires a PostgreSQL test service + pg@8
```

## Not yet claimed

The foundation does **not** claim:

- MySQL/MariaDB/SQL Server runtime compatibility yet;
- SFTP support yet;
- OS installer/daemon packaging yet;
- unattended production readiness;
- automatic source-file retention/pruning policy for archived watch-folder files.

Those capabilities stay on the U3/U4 roadmap until implementation and evidence exist.
