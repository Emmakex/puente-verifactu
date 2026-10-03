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
- pinned, non-destructive SFTP drop-folder ingress with durable receipts;
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
const driver = createReadOnlyDatabaseDriver({
  dialect: 'postgresql',
  verifyReadOnly: async () => verifyDatabaseRole(),
  fetchPage: async ({ query, cursor, limit }) => fetchRows(query, [cursor, limit]),
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

Vendor adapters are provided for:

- PostgreSQL through a `pg` pool, with every verification and extraction query inside `BEGIN READ ONLY`;
- MySQL/MariaDB through a `mysql2/promise` pool, with `START TRANSACTION READ ONLY`;
- SQL Server through an `mssql` pool, with a permission/role probe plus a SELECT-only source query contract.

The repository does not bundle those vendor packages into the core runtime. The Local Agent packaging layer installs only the driver required by the customer.

CI compatibility evidence runs against PostgreSQL 16, MySQL 8.4, MariaDB 11.4 and SQL Server 2022. Production credentials still must be provisioned SELECT-only; the runtime guard is defense in depth.

## SFTP drop-folder

SFTP is an optional remote file ingress for systems that can only export files to a managed server. It is deliberately **non-destructive by default**:

- only regular `.csv` / `.xlsx` files are downloaded;
- the remote file is never renamed or deleted;
- host-key verification is mandatory and pinned with SHA-256;
- password/private-key credentials live only in Local Agent runtime configuration and are not written to manifests or receipts;
- each remote identity (directory + filename + size + modification time) has a durable SQLite receipt, preventing repeated downloads across restarts;
- downloaded bytes are size-checked and SHA-256 fingerprinted before being admitted to the local inbox;
- SFTP receipts are transport deduplication; fiscal idempotency remains enforced independently by the durable row queue and Puente API;
- the existing watch-folder pipeline still owns parsing, MappingProfile, preflight, issue, quarantine and row idempotency.

A source SFTP account can therefore be provisioned with read-only filesystem permissions. CI proves this by reading a real SFTP source and verifying that an attempted remote upload is rejected.

`createSftpConnectionConfig()` requires a pinned host fingerprint in either 64-character SHA-256 hex or OpenSSH `SHA256:...` format. The underlying SSH client is configured with `hostHash='sha256'` and a fail-closed verifier.

## SFTP source

The SFTP source is a non-destructive drop-folder adapter for legacy systems that can export CSV/XLSX to a remote server but cannot call the Puente API directly.

Security and durability rules:

- remote SSH host identity is pinned with a required SHA-256 host-key fingerprint;
- password or private-key authentication is supported, but credentials are never written into queue payloads or manifests;
- only regular `.csv` / `.xlsx` files are accepted;
- remote files are read with `list()` + `get()` only; the adapter never renames, deletes or uploads source files;
- remote source folders should be provisioned read-only for the Local Agent account;
- file age and size limits are checked before download, listed/downloaded byte counts must match, and content SHA-256 defines the revision identity;
- downloaded bytes are SHA-256 fingerprinted and handed to the existing private watch-folder pipeline;
- each eligible file is downloaded and fingerprinted before deduplication; durable source receipts prevent staging the same content revision twice after restart;
- `issueEnabled=true` remains an explicit fail-closed requirement.

A deployment installs `ssh2-sftp-client@12.1.1` only when SFTP is needed. CI runs a real SFTP server, pins its generated Ed25519 host key, proves that the remote drop directory rejects uploads, downloads a CSV, hands it to the existing `mapped-source` pipeline and verifies that a second poll is idempotent.

The first SFTP unit is intentionally inbound/read-only. Remote acknowledgements, deletes or moves are not performed because they would mutate the customer's source system.

## Gate

```bash
npm run local-agent:smoke
npm run local-agent:contract
npm run local-agent:sftp:smoke # Docker + ssh2-sftp-client@12.1.1
```

## Not yet claimed

The foundation does **not** claim:

- OS installer/daemon packaging yet;
- unattended production readiness;
- automatic source-file retention/pruning policy for archived watch-folder files.

Those capabilities stay on the U3/U4 roadmap until implementation and evidence exist.
