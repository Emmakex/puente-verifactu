import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlitePersistence } from '../../../packages/sqlite-store/src/index.mjs';
import { buildLiveGateFixture } from '../live-gate-lib.mjs';
import {
  assertControlledReconciliationSeedDestinations,
  createControlledReconciliationSeed,
  releaseControlledReconciliationSeedReservations,
} from '../reconciliation-seed-lib.mjs';

const env = {
  AEAT_TEST_ISSUER_NAME: 'Empresa Demo SL',
  AEAT_TEST_ISSUER_NIF: 'B12345678',
  AEAT_TEST_PRODUCER_NIF: 'B87654321',
  AEAT_TEST_PRODUCER_NAME: 'Kairoseth Extensions',
  AEAT_TEST_TIMEZONE: 'Europe/Madrid',
};
const sourceCommit = '0123456789abcdef0123456789abcdef01234567';

function acceptedPayload() {
  const fixture = buildLiveGateFixture(env, new Date('2026-09-15T08:00:00.000Z'));
  return {
    fixture,
    payload: { issuer: fixture.issuer, entries: [{ intent: fixture.intent, record: fixture.record }] },
  };
}

test('controlled seed creates private SQLite quarantine and private operator file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pvf-seed-'));
  try {
    const databasePath = join(root, 'private', 'reconciliation.sqlite');
    const operatorOutputPath = join(root, 'private', 'operator.json');
    const { fixture, payload } = acceptedPayload();
    const result = await createControlledReconciliationSeed({
      databasePath,
      operatorOutputPath,
      payload,
      sourceCommit,
      liveResult: { status: 'accepted', csv: 'DO-NOT-PERSIST-CSV' },
      recordedAt: new Date('2026-09-15T12:00:00Z'),
    });

    assert.equal(result.status, 'seeded');
    assert.equal(result.state, 'reconciliation_required');
    assert.equal(result.submitCountAdded, 0);
    assert.equal(result.shouldReissue, false);
    assert.match(result.jobIdSha256, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(result), /B12345678|DO-NOT-PERSIST-CSV|gate-20260915080000/);
    assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
    assert.equal((await stat(operatorOutputPath)).mode & 0o777, 0o600);

    const operator = JSON.parse(await readFile(operatorOutputPath, 'utf8'));
    assert.equal(operator.sourceCommit, sourceCommit);
    assert.equal(operator.state, 'reconciliation_required');
    assert.equal(operator.jobIdSha256, result.jobIdSha256);

    const persistence = createSqlitePersistence({ path: databasePath });
    try {
      const job = persistence.aeatOutbox.get(operator.jobId);
      assert.equal(job.state, 'reconciliation_required');
      assert.equal(job.lastResult.reason, 'controlled_live_gate_reconciliation_seed');
      assert.equal(job.lastResult.sourceCommit, sourceCommit);
      assert.equal(job.payload.entries[0].record.hash, fixture.record.hash);
      assert.equal(job.payload.entries[0].record.source.sourceInvoiceId, fixture.record.source.sourceInvoiceId);
      assert.doesNotMatch(JSON.stringify(job.lastResult), /DO-NOT-PERSIST-CSV/);
    } finally {
      persistence.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('seed rejects non-accepted result before creating private files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pvf-seed-reject-'));
  try {
    const databasePath = join(root, 'seed.sqlite');
    const operatorOutputPath = join(root, 'operator.json');
    const { payload } = acceptedPayload();
    await assert.rejects(
      () => createControlledReconciliationSeed({
        databasePath,
        operatorOutputPath,
        payload,
        sourceCommit,
        liveResult: { status: 'rejected' },
      }),
      { code: 'VF_AEAT_RECONCILIATION_SEED_REQUIRES_ACCEPTED' },
    );
    await assert.rejects(() => stat(databasePath), { code: 'ENOENT' });
    await assert.rejects(() => stat(operatorOutputPath), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('destination reservation is exclusive and never overwrites existing data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pvf-seed-existing-'));
  try {
    const databasePath = join(root, 'seed.sqlite');
    const operatorOutputPath = join(root, 'operator.json');
    await writeFile(databasePath, 'existing-sensitive-database-placeholder', { mode: 0o600 });
    await assert.rejects(
      () => assertControlledReconciliationSeedDestinations({ databasePath, operatorOutputPath }),
      { code: 'VF_AEAT_RECONCILIATION_SEED_TARGET_EXISTS' },
    );
    assert.equal(await readFile(databasePath, 'utf8'), 'existing-sensitive-database-placeholder');
    await assert.rejects(() => stat(operatorOutputPath), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reservations can be released before certificate/network use', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pvf-seed-release-'));
  try {
    const paths = await assertControlledReconciliationSeedDestinations({
      databasePath: join(root, 'seed.sqlite'),
      operatorOutputPath: join(root, 'operator.json'),
    });
    assert.equal((await stat(paths.databasePath)).mode & 0o777, 0o600);
    assert.equal((await stat(paths.operatorOutputPath)).mode & 0o777, 0o600);
    await releaseControlledReconciliationSeedReservations(paths);
    await assert.rejects(() => stat(paths.databasePath), { code: 'ENOENT' });
    await assert.rejects(() => stat(paths.operatorOutputPath), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
