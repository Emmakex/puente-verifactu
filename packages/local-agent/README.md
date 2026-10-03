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

## Unified runtime

U4.1 adds one operational runtime on top of the existing sources. The same process can run a watch-folder, database or SFTP installation without opening an inbound HTTP listener.

The runtime cycle is:

```text
recover leases / processing files
  -> poll configured source
  -> durable queue
  -> preflight
  -> issue
  -> settle/quarantine
  -> redact terminal payloads
```

Configuration is JSON schema version 1. The file must be private (`0600`) on POSIX. Secrets are not accepted inline: the bridge API key, database password and SFTP password/passphrase are referenced by environment-variable name. The AEAT certificate/private key remain server-side and are never valid Local Agent configuration fields.

Commands:

```bash
npm run local-agent:cli -- doctor --config /etc/puente-verifactu/agent.json
npm run local-agent:cli -- status --config /etc/puente-verifactu/agent.json
npm run local-agent:cli -- once --config /etc/puente-verifactu/agent.json
npm run local-agent:cli -- start --config /etc/puente-verifactu/agent.json
```

`doctor` is non-destructive: it probes `/readyz`, the local store and the configured source read-only capability. It never calls preflight or issue. `status` reads only local operational metadata and does not require runtime secrets.

`once` and `start` use a single-instance lock under the data directory. `start` handles `SIGINT`/`SIGTERM`, finishes resource cleanup and does not host any local network listener.

See `config/local-agent.example.json` for the fail-closed starting configuration (`issueEnabled=false`).

## Portable bundle

U4.3 builds one architecture-neutral JavaScript ZIP and tests that exact artifact on supported native GitHub-hosted runners before compatibility is claimed.

The bundle contains only the Local Agent runtime plus the core, SDK and file-import modules it imports. It excludes repository tests, certificates, private keys, environment files and unrelated server/connector code.

Release properties:

- exact 40-character source commit embedded in `bundle-manifest.json`;
- reproducible stored ZIP with deterministic entry ordering/timestamps;
- SHA-256 sidecar for the whole artifact;
- content fingerprint over every bundled file;
- Node.js `>=22.13.0` bootstrap check;
- runtime dependencies pinned to exact versions;
- same ZIP downloaded by Linux x64, Windows x64, macOS Intel x64 and macOS ARM64 jobs;
- native smoke installs the pinned dependencies and runs `status` + non-destructive `doctor`;
- the smoke fixture keeps `issueEnabled=false`.

Build:

```bash
PV_SOURCE_COMMIT=<40-char-sha> npm run local-agent:package -- \
  --source-commit "$PV_SOURCE_COMMIT" \
  --output dist/kairoseth-local-agent.zip
```

The portable bundle is deliberately separate from system service installation. U4.4 adds systemd, launchd and Windows startup/service integration on top of the already-tested artifact.

## Native system startup

U4.4 installs the already-tested portable bundle using only native operating-system facilities:

- Linux: hardened `systemd` unit running as the dedicated `kairoseth-agent` account;
- macOS: `launchd` daemon running as an explicit non-root local user;
- Windows: native Task Scheduler startup task running as `SYSTEM`, without NSSM/WinSW/node-windows or another opaque service wrapper.

Code, configuration and local state are deliberately separated:

```text
Linux
  code:   /opt/kairoseth/local-agent/
  config: /etc/kairoseth-local-agent/
  data:   /var/lib/kairoseth-local-agent/

macOS
  code:   /Library/Kairoseth/LocalAgent/
  state:  /Library/Application Support/Kairoseth/LocalAgent/

Windows
  code:   %ProgramData%\Kairoseth\LocalAgent\app\
  config: %ProgramData%\Kairoseth\LocalAgent\config\
  data:   %ProgramData%\Kairoseth\LocalAgent\data\
```

Each installed code release lives under a version + source-commit directory and a `current` link/junction selects the active code. Reinstalling the same bundle is idempotent. Configuration is preserved unless an explicit replace option is supplied. Uninstall removes the startup integration and code while preserving configuration/secrets and SQLite/data.

Windows configuration/data ACL inheritance is removed and access is restricted to `SYSTEM` and local Administrators. POSIX configuration and secret files are installed with mode `0600`.

Native CI takes the exact ZIP produced by the portable build and, on each supported runner, performs:

```text
install
  -> verify native integration files/ACLs
  -> create local state marker
  -> reinstall with a different config candidate
  -> prove original config + local state survived
  -> uninstall code
  -> prove config + secret env + local state still survive
```

Service activation is intentionally separate from installation in the smoke tests. Production installation can opt into enabling/starting the native startup mechanism after configuration has been reviewed.

## Upgrade and rollback

U4.5 treats Local Agent code and SQLite state as separate lifecycles.

Before a code release can become `current`, the target bundle must:

- match every bundled file against the manifest SHA-256 and byte count;
- match the manifest-wide content fingerprint;
- declare a readable Local Agent state-schema range;
- run on a Node version that supports the required SQLite backup API;
- acquire the Local Agent data-dir lock so an active agent cannot be upgraded underneath;
- run SQLite `quick_check`;
- reject a newer/incompatible state schema;
- create a verified pre-upgrade SQLite backup when `agent.sqlite` exists;
- preserve job/checkpoint/receipt counts between source and backup.

The runtime state schema is stored in SQLite `PRAGMA user_version`. Existing Local Agent databases created before this field existed are recognized as legacy schema 1 and stamped as schema 1 when opened by the current runtime.

Native upgrade tools live beside the installers:

```text
Linux:   service/linux/upgrade.sh   + rollback.sh
macOS:   service/macos/upgrade.sh   + rollback.sh
Windows: service/windows/upgrade.ps1 + rollback.ps1
```

Upgrade activates a new versioned code directory only after the guard and backup succeed. The upgrade receipt records previous code, target code and backup evidence outside the release tree.

Rollback is deliberately **code-only**. It changes the `current` symlink/junction back to the previous release. Rollback scripts do not read the backup path, do not open `agent.sqlite`, and never restore SQLite automatically. The backup is evidence/recovery material for an explicit operator decision, not an automatic rollback mechanism.

CI proves this distinction by:

```text
state before upgrade: 1 queued operation
backup before activation: 1 queued operation
state after upgrade: 2 queued operations
rollback code to previous release
state after rollback: still 2 queued operations
backup remains: 1 queued operation
```

Thus a code rollback cannot silently erase work accepted after the upgrade.

## Gate

```bash
npm run local-agent:smoke
npm run local-agent:contract
npm run local-agent:runtime:smoke
npm run local-agent:package:check
npm run local-agent:service:check
npm run local-agent:upgrade:smoke
npm run local-agent:sftp:smoke # Docker + ssh2-sftp-client@12.1.1
```

## Not yet claimed

The foundation does **not** claim:

- unattended production readiness;
- automatic source-file retention/pruning policy for archived watch-folder files.

Those capabilities stay on the U3/U4 roadmap until implementation and evidence exist.
