import { createHash } from 'node:crypto';
import { chmod, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createSqlitePersistence } from '../../packages/sqlite-store/src/index.mjs';

function seedError(code, message, field = null) {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  return error;
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function reserveExclusiveFile(path, { mkdirFn = mkdir, openFn = open } = {}) {
  const target = resolve(path);
  await mkdirFn(dirname(target), { recursive: true });
  let handle;
  try {
    handle = await openFn(target, 'wx', 0o600);
  } catch (cause) {
    if (cause?.code === 'EEXIST') {
      throw seedError('VF_AEAT_RECONCILIATION_SEED_TARGET_EXISTS', `Refusing to overwrite existing private seed target: ${target}`);
    }
    throw seedError('VF_AEAT_RECONCILIATION_SEED_TARGET_UNAVAILABLE', `Private seed target cannot be reserved: ${target}`);
  } finally {
    try { await handle?.close(); } catch {}
  }
  return target;
}

export async function assertControlledReconciliationSeedDestinations({ databasePath, operatorOutputPath }, dependencies = {}) {
  if (!databasePath || !operatorOutputPath) {
    throw seedError('VF_AEAT_RECONCILIATION_SEED_PATHS_REQUIRED', 'Both reconciliation seed database and operator output paths are required');
  }
  const reserved = [];
  try {
    const db = await reserveExclusiveFile(databasePath, dependencies);
    reserved.push(db);
    const operator = await reserveExclusiveFile(operatorOutputPath, dependencies);
    reserved.push(operator);
    return { databasePath: db, operatorOutputPath: operator };
  } catch (error) {
    for (const path of reserved) {
      try { await (dependencies.rmFn ?? rm)(path, { force: true }); } catch {}
    }
    throw error;
  }
}

export async function releaseControlledReconciliationSeedReservations({ databasePath, operatorOutputPath }, { rmFn = rm } = {}) {
  for (const path of [databasePath, operatorOutputPath]) {
    if (!path) continue;
    try { await rmFn(resolve(path), { force: true }); } catch {}
  }
}

export async function createControlledReconciliationSeed({
  databasePath,
  operatorOutputPath,
  payload,
  sourceCommit,
  liveResult,
  recordedAt = new Date(),
  reservationsAlreadyHeld = false,
}, dependencies = {}) {
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit ?? '')) {
    throw seedError('VF_AEAT_RECONCILIATION_SEED_SOURCE_COMMIT_REQUIRED', 'A 40-character source commit SHA is required for reconciliation seed');
  }
  if (liveResult?.status !== 'accepted') {
    throw seedError('VF_AEAT_RECONCILIATION_SEED_REQUIRES_ACCEPTED', 'Controlled reconciliation seed is only allowed after an accepted AEAT response');
  }
  if (!payload?.issuer || !Array.isArray(payload?.entries) || payload.entries.length < 1) {
    throw seedError('VF_AEAT_RECONCILIATION_SEED_PAYLOAD_INVALID', 'Accepted AEAT request payload is required for reconciliation seed');
  }

  const paths = reservationsAlreadyHeld
    ? { databasePath: resolve(databasePath), operatorOutputPath: resolve(operatorOutputPath) }
    : await assertControlledReconciliationSeedDestinations({ databasePath, operatorOutputPath }, dependencies);

  const makePersistence = dependencies.createSqlitePersistence ?? createSqlitePersistence;
  const chmodFn = dependencies.chmodFn ?? chmod;
  const writeFileFn = dependencies.writeFileFn ?? writeFile;
  const rmFn = dependencies.rmFn ?? rm;
  const now = recordedAt.getTime();
  let persistence;
  let seeded = false;

  try {
    persistence = makePersistence({ path: paths.databasePath });
    const outbox = persistence.aeatOutbox;
    const job = outbox.enqueue(payload, { availableAt: now, now });
    const owner = 'controlled-live-gate-seed';
    const claimed = outbox.claim(job.id, { owner, now, leaseMs: 60000 });
    if (!claimed) throw seedError('VF_AEAT_RECONCILIATION_SEED_CLAIM_FAILED', 'Controlled reconciliation seed could not claim its private outbox job');
    const quarantined = outbox.settle(job.id, {
      owner,
      state: 'reconciliation_required',
      lastResult: {
        kind: 'reconciliation_required',
        status: 'unknown',
        retryable: false,
        reason: 'controlled_live_gate_reconciliation_seed',
        sourceCommit: sourceCommit.toLowerCase(),
      },
      now,
    });
    if (quarantined.state !== 'reconciliation_required') {
      throw seedError('VF_AEAT_RECONCILIATION_SEED_STATE_INVALID', 'Controlled reconciliation seed did not enter reconciliation_required');
    }
    seeded = true;
    persistence.close();
    persistence = null;
    await chmodFn(paths.databasePath, 0o600);

    const privateOperator = {
      schemaVersion: 1,
      kind: 'aeat-controlled-reconciliation-seed-private',
      createdAt: recordedAt.toISOString(),
      sourceCommit: sourceCommit.toLowerCase(),
      databasePath: paths.databasePath,
      jobId: quarantined.id,
      jobIdSha256: sha256(quarantined.id),
      state: quarantined.state,
      instructions: 'Use jobId with npm run aeat:reconcile. Keep this file private and outside Git.',
    };

    await writeFileFn(paths.operatorOutputPath, `${JSON.stringify(privateOperator, null, 2)}\n`, { flag: 'w', mode: 0o600 });
    await chmodFn(paths.operatorOutputPath, 0o600);

    return {
      schemaVersion: 1,
      status: 'seeded',
      sourceCommit: sourceCommit.toLowerCase(),
      jobIdSha256: privateOperator.jobIdSha256,
      state: quarantined.state,
      submitCountAdded: 0,
      shouldReissue: false,
    };
  } catch (error) {
    try { persistence?.close?.(); } catch {}
    if (!seeded) {
      for (const path of [paths.databasePath, `${paths.databasePath}-wal`, `${paths.databasePath}-shm`, paths.operatorOutputPath]) {
        try { await rmFn(path, { force: true }); } catch {}
      }
    }
    throw error;
  }
}
