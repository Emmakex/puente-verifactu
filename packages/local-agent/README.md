# Local Agent v1

Foundation for the local/offline integration channel of **Kairoseth Extensions → Puente VeriFactu**.

## Purpose

The Local Agent is for ERP, POS, desktop software and local-network systems that cannot reliably integrate through a native plugin or direct server-to-server API.

It is intentionally **not** a fiscal engine. The agent moves source data toward Puente and keeps a durable local queue. AEAT rules, certificates, tenant authority, mapping authority and the fiscal record lifecycle remain on the Puente/Kairoseth server.

## Foundation included

- SQLite local store using Node 22 `node:sqlite`;
- durable queue;
- stable idempotency key derived from `sourceId + sourceKey`;
- worker leases;
- crash recovery;
- retry with bounded exponential backoff;
- blocked state for non-retryable failures;
- durable source checkpoints;
- deterministic CSV/XLSX watch-folder discovery;
- outbound HTTPS policy;
- adapter manifest bound to `kairoseth/extensions/puente-verifactu`.

## Safety model

### No inbound network listener

The foundation opens no inbound HTTP port. The intended architecture is outbound-only toward Kairoseth/Puente.

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

This foundation **does not yet send the file automatically**. The next U3 unit connects queued `watch-file` jobs to the existing CSV/XLSX parser, MappingProfile and preflight flow, then adds processed/error quarantine.

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
- automatic folder quarantine yet;
- unattended production readiness.

Those capabilities stay on the U3/U4 roadmap until implementation and evidence exist.
