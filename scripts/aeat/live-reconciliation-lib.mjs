import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AeatVerifactuAdapter } from '../../packages/aeat-adapter/src/adapter.mjs';
import { AeatOfficialReconciler } from '../../packages/aeat-adapter/src/reconciliation.mjs';
import { createHttpsMtlsTransport } from '../../packages/aeat-adapter/src/transport.mjs';
import { createSqlitePersistence } from '../../packages/sqlite-store/src/index.mjs';
import { loadPfxCredentials } from './certificate-preflight-lib.mjs';

function cliError(code, message, field = null) {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  return error;
}

function valueFor(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw cliError('VF_AEAT_RECONCILIATION_OPTION_VALUE_REQUIRED', `${flag} requires a value`, flag);
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function fiscalHashFingerprint(value) {
  const hash = String(value ?? '').trim().toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hash)) {
    throw cliError(
      'VF_AEAT_RECONCILIATION_RECORD_HASH_REQUIRED',
      'Reconciliation evidence requires a valid 64-character fiscal record hash',
      'record.hash',
    );
  }
  return sha256(hash);
}

export function parseLiveReconciliationOptions(argv = [], env = process.env) {
  const allowedFlags = new Set(['--db', '--job-id', '--apply', '--source-commit', '--evidence-output']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--') || !allowedFlags.has(token)) {
      throw cliError('VF_AEAT_RECONCILIATION_OPTION_UNKNOWN', `Unsupported option: ${token}`, token);
    }
    if (token !== '--apply') index += 1;
  }

  const databasePath = String(valueFor(argv, '--db') ?? '').trim();
  const jobId = String(valueFor(argv, '--job-id') ?? '').trim();
  const apply = argv.includes('--apply');
  const sourceCommit = valueFor(argv, '--source-commit');
  const evidenceOutput = valueFor(argv, '--evidence-output');

  if (!databasePath || databasePath === ':memory:') {
    throw cliError('VF_AEAT_RECONCILIATION_DB_REQUIRED', '--db must point to an existing file-backed SQLite database', '--db');
  }
  if (!jobId) {
    throw cliError('VF_AEAT_RECONCILIATION_JOB_REQUIRED', '--job-id is required', '--job-id');
  }
  if (apply && env.AEAT_RECONCILIATION_APPLY !== 'YES') {
    throw cliError(
      'VF_AEAT_RECONCILIATION_APPLY_GUARD',
      'Applying reconciliation requires both --apply and AEAT_RECONCILIATION_APPLY=YES',
      '--apply',
    );
  }
  if (sourceCommit != null && !/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    throw cliError('VF_AEAT_RECONCILIATION_SOURCE_COMMIT_INVALID', '--source-commit must be a 40-character commit SHA', '--source-commit');
  }
  if (evidenceOutput && !sourceCommit) {
    throw cliError('VF_AEAT_RECONCILIATION_SOURCE_COMMIT_REQUIRED', '--evidence-output requires --source-commit', '--source-commit');
  }

  return {
    databasePath,
    jobId,
    apply,
    sourceCommit: sourceCommit?.toLowerCase() ?? null,
    evidenceOutput,
  };
}

export async function assertExistingDatabase(path, { statFn = stat } = {}) {
  let info;
  try {
    info = await statFn(resolve(path));
  } catch {
    throw cliError('VF_AEAT_RECONCILIATION_DB_UNREADABLE', 'The configured SQLite database cannot be read', '--db');
  }
  if (!info.isFile()) {
    throw cliError('VF_AEAT_RECONCILIATION_DB_INVALID', 'The configured SQLite database must be a regular file', '--db');
  }
}

export async function assertEvidenceDestinationAvailable(path, { statFn = stat } = {}) {
  if (!path) return;
  try {
    await statFn(resolve(path));
    throw cliError('VF_AEAT_RECONCILIATION_EVIDENCE_EXISTS', 'Evidence output already exists and will not be overwritten');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    if (error?.code === 'VF_AEAT_RECONCILIATION_EVIDENCE_EXISTS') throw error;
    throw cliError('VF_AEAT_RECONCILIATION_EVIDENCE_PATH_UNREADABLE', 'Evidence output destination cannot be validated');
  }
}

function rowToJob(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    payload: JSON.parse(row.payload_json),
    state: row.state,
    attempts: Number(row.attempts),
    availableAt: Number(row.available_at_ms),
    lastResult: row.last_result_json == null ? null : JSON.parse(row.last_result_json),
    leaseOwner: row.lease_owner ?? null,
    leaseUntil: row.lease_until_ms == null ? null : Number(row.lease_until_ms),
    createdAt: Number(row.created_at_ms),
    updatedAt: Number(row.updated_at_ms),
  });
}

export function openReadOnlyAeatOutbox(path, { Database = DatabaseSync } = {}) {
  let db;
  try {
    db = new Database(resolve(path), { readOnly: true });
    const select = db.prepare('SELECT * FROM aeat_outbox WHERE id = ?');
    return {
      get(id) {
        return rowToJob(select.get(id));
      },
      resolveReconciliation() {
        throw cliError('VF_AEAT_RECONCILIATION_READ_ONLY', 'Read-only reconciliation cannot update the outbox');
      },
      close() {
        db.close();
      },
    };
  } catch {
    try { db?.close(); } catch {}
    throw cliError('VF_AEAT_RECONCILIATION_DB_OPEN_FAILED', 'The SQLite outbox could not be opened for reconciliation');
  }
}

function validateTargetJob(job) {
  if (!job) throw cliError('VF_AEAT_OUTBOX_JOB_NOT_FOUND', 'Outbox job not found');
  if (job.state !== 'reconciliation_required') {
    throw cliError('VF_AEAT_OUTBOX_NOT_RECONCILABLE', 'Outbox job is not awaiting reconciliation');
  }
  if (!Array.isArray(job.payload?.entries) || job.payload.entries.length === 0) {
    throw cliError('VF_AEAT_RECONCILIATION_ENTRIES_REQUIRED', 'Reconciliation needs at least one fiscal entry');
  }
  if (!job.payload?.issuer?.taxId || !job.payload?.issuer?.name) {
    throw cliError('VF_AEAT_RECONCILIATION_ISSUER_REQUIRED', 'Outbox job does not contain the issuer identity required by AEAT query');
  }
  return job;
}

export function sanitizeLiveReconciliation({ options, certificateSummary, beforeJob, result, recordedAt = new Date() }) {
  const entries = result.assessment?.entries ?? [];
  const entryRecordHashFingerprints = beforeJob.payload.entries.map((entry) => fiscalHashFingerprint(entry?.record?.hash));
  return {
    schemaVersion: 1,
    gate: 'aeat-official-reconciliation-live',
    recordedAt: recordedAt.toISOString(),
    environment: 'test',
    mode: options.apply ? 'apply' : 'inspect',
    sourceCommit: options.sourceCommit,
    jobIdSha256: sha256(options.jobId),
    entryRecordHashFingerprints,
    certificate: {
      pfxSha256: certificateSummary.pfxSha256,
      passphraseSource: certificateSummary.passphraseSource,
    },
    beforeState: beforeJob.state,
    afterState: result.job?.state ?? beforeJob.state,
    assessment: {
      outcome: result.assessment?.outcome ?? 'unknown',
      allReceived: Boolean(result.assessment?.allReceived),
      shouldReissue: false,
      applied: Boolean(result.assessment?.applied),
      entryCount: entries.length,
      entries: entries.map((entry) => ({
        outcome: entry.assessment?.outcome ?? 'unknown',
        received: Boolean(entry.assessment?.received),
        storedState: entry.assessment?.storedState ?? null,
        reason: entry.assessment?.reason ?? null,
        errorCode: entry.assessment?.errorCode ?? null,
      })),
    },
  };
}

export async function writeLiveReconciliationEvidence(path, evidence, { mkdirFn = mkdir, writeFileFn = writeFile } = {}) {
  const target = resolve(path);
  await mkdirFn(dirname(target), { recursive: true });
  try {
    await writeFileFn(target, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (cause) {
    if (cause?.code === 'EEXIST') {
      throw cliError('VF_AEAT_RECONCILIATION_EVIDENCE_EXISTS', 'Evidence output already exists and will not be overwritten');
    }
    throw cliError('VF_AEAT_RECONCILIATION_EVIDENCE_WRITE_FAILED', 'Evidence output could not be written');
  }
}

export async function runLiveReconciliation({
  argv = process.argv.slice(2),
  env = process.env,
  clock = () => new Date(),
  dependencies = {},
} = {}) {
  const options = parseLiveReconciliationOptions(argv, env);
  const assertDatabase = dependencies.assertExistingDatabase ?? assertExistingDatabase;
  const assertEvidence = dependencies.assertEvidenceDestinationAvailable ?? assertEvidenceDestinationAvailable;
  const loadCredentials = dependencies.loadPfxCredentials ?? loadPfxCredentials;
  const makeTransport = dependencies.createHttpsMtlsTransport ?? createHttpsMtlsTransport;
  const makePersistence = dependencies.createSqlitePersistence ?? createSqlitePersistence;
  const openReadOnly = dependencies.openReadOnlyAeatOutbox ?? openReadOnlyAeatOutbox;
  const Adapter = dependencies.Adapter ?? AeatVerifactuAdapter;
  const Reconciler = dependencies.Reconciler ?? AeatOfficialReconciler;
  const writeEvidence = dependencies.writeEvidence ?? writeLiveReconciliationEvidence;

  await assertDatabase(options.databasePath);

  let resource;
  try {
    if (options.apply) {
      try {
        resource = makePersistence({ path: options.databasePath });
      } catch {
        throw cliError('VF_AEAT_RECONCILIATION_DB_OPEN_FAILED', 'The SQLite outbox could not be opened for reconciliation');
      }
    } else {
      resource = openReadOnly(options.databasePath);
    }

    const outbox = options.apply ? resource.aeatOutbox : resource;
    const beforeJob = validateTargetJob(outbox.get(options.jobId));
    await assertEvidence(options.evidenceOutput);
    const { pfx, passphrase, summary: certificateSummary } = await loadCredentials(env);
    const transport = makeTransport({ tls: { pfx, passphrase } });
    const sif = beforeJob.payload.entries[0]?.record?.sif ?? { systemId: 'PV' };
    const adapter = new Adapter({ sif, environment: 'test', transport });
    const reconciler = new Reconciler({ adapter, outbox, clock: () => clock().getTime() });
    const result = await reconciler.inspect(options.jobId, { apply: options.apply });
    const evidence = sanitizeLiveReconciliation({
      options,
      certificateSummary,
      beforeJob,
      result,
      recordedAt: clock(),
    });

    if (options.evidenceOutput) await writeEvidence(options.evidenceOutput, evidence);
    return evidence;
  } finally {
    try { resource?.close?.(); } catch {}
  }
}
