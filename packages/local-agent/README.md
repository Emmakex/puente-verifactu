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

Future generic DB adapters are read-only by default. The foundation already declares `source_read_only=true`.

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

## Checkpoints

Database adapters will use:

```js
store.setCheckpoint('erp-orders', { lastId: 12000 });
store.getCheckpoint('erp-orders');
```

The checkpoint is transport/source progress. It is not a fiscal record and never replaces server-side idempotency.

## Gate

```bash
npm run local-agent:smoke
npm run local-agent:contract
```

## Not yet claimed

The foundation does **not** claim:

- PostgreSQL/MySQL/SQL Server compatibility yet;
- SFTP support yet;
- OS installer/daemon packaging yet;
- unattended production readiness;
- automatic local retention/pruning policy for completed queue payloads.

Those capabilities stay on the U3/U4 roadmap until implementation and evidence exist.
