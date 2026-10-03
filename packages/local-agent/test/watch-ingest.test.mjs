import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAgentStore } from '../src/store.mjs';
import { LocalAgentWorker, createPuenteApiTransport } from '../src/worker.mjs';
import {
  ensureWatchFolderLayout,
  ingestWatchFolder,
  recoverProcessingWatchFiles,
  settleWatchFolder,
} from '../src/watch-ingest.mjs';

async function tempWatchRoot(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  return ensureWatchFolderLayout(root);
}

test('watch-folder issuance is explicit opt-in and does not move files while disabled', async () => {
  const layout = await tempWatchRoot('pv-watch-optin-');
  await writeFile(join(layout.inbox, 'facturas.csv'), 'numero,total\nA-1,10\n');

  const store = new LocalAgentStore(':memory:');
  await assert.rejects(
    () => ingestWatchFolder({
      store,
      root: layout.root,
      sourceId: 'watch-main',
      profileId: 'profile-main',
      issueEnabled: false,
      minAgeMs: 0,
    }),
    (error) => error.code === 'VF_LOCAL_AGENT_WATCH_ISSUE_NOT_ENABLED',
  );

  assert.deepEqual(await readdir(layout.inbox), ['facturas.csv']);
  assert.equal(store.list().length, 0);
  store.close();
});

test('watch-folder fans out rows, preflights server-side and quarantines a rejected batch', async () => {
  const layout = await tempWatchRoot('pv-watch-error-');
  await writeFile(
    join(layout.inbox, 'facturas.csv'),
    'numero,cliente,total\nA-1,Cliente Uno,10\nA-2,Cliente Secreto,20\n',
  );

  const store = new LocalAgentStore(':memory:');
  const staged = await ingestWatchFolder({
    store,
    root: layout.root,
    sourceId: 'watch-main',
    profileId: 'profile-main',
    issueEnabled: true,
    minAgeMs: 0,
    now: 1_000,
  });

  assert.equal(staged.staged.length, 1);
  assert.equal(staged.staged[0].rows, 2);
  assert.equal(store.list().length, 2);
  assert.deepEqual(await readdir(layout.inbox), []);

  const processing = await readdir(layout.processing);
  const manifestName = processing.find((name) => name.endsWith('.pv-manifest.json'));
  assert.ok(manifestName);
  const manifestText = await readFile(join(layout.processing, manifestName), 'utf8');
  assert.doesNotMatch(manifestText, /Cliente Secreto|Cliente Uno/);

  const issued = [];
  const transport = createPuenteApiTransport({
    async preflightMapped(profileId, source) {
      assert.equal(profileId, 'profile-main');
      if (source.numero === 'A-2') {
        return {
          ok: false,
          summary: { rows: 1, valid: 0, invalid: 1 },
          rows: [{ row: 2, status: 'invalid', errors: [{ code: 'TEST_INVALID' }] }],
        };
      }
      return { ok: true, summary: { rows: 1, valid: 1, invalid: 0 }, rows: [] };
    },
    async issueMapped(profileId, source, { idempotencyKey }) {
      issued.push({ profileId, number: source.numero, idempotencyKey });
      return { recordId: `record-${source.numero}`, status: 'accepted' };
    },
  });
  const worker = new LocalAgentWorker({
    store,
    owner: 'watch-worker',
    leaseMs: 1_000,
    now: () => 1_000,
    transport,
  });

  const report = await worker.runDue({ limit: 10 });
  assert.equal(report.processed, 2);
  assert.equal(report.completed, 1);
  assert.equal(report.blocked, 1);
  assert.equal(issued.length, 1);
  assert.equal(issued[0].number, 'A-1');

  const settled = await settleWatchFolder({ store, root: layout.root });
  assert.equal(settled.settled.length, 1);
  assert.equal(settled.settled[0].state, 'blocked');
  assert.equal((await readdir(layout.processing)).length, 0);

  const errorFiles = await readdir(layout.error);
  assert.ok(errorFiles.some((name) => name.endsWith('.csv')));
  assert.ok(errorFiles.some((name) => name.endsWith('.pv-manifest.json')));
  store.close();
});

test('watch-folder archives a fully accepted batch as processed', async () => {
  const layout = await tempWatchRoot('pv-watch-success-');
  await writeFile(join(layout.inbox, 'ok.csv'), 'numero,total\nB-1,10\nB-2,20\n');

  const store = new LocalAgentStore(':memory:');
  await ingestWatchFolder({
    store,
    root: layout.root,
    sourceId: 'watch-ok',
    profileId: 'profile-ok',
    issueEnabled: true,
    minAgeMs: 0,
    now: 5_000,
  });

  const worker = new LocalAgentWorker({
    store,
    owner: 'worker-ok',
    leaseMs: 1_000,
    now: () => 5_000,
    transport: createPuenteApiTransport({
      async preflightMapped() {
        return { ok: true, summary: { rows: 1, valid: 1, invalid: 0 } };
      },
      async issueMapped(profileId, source, { idempotencyKey }) {
        assert.equal(profileId, 'profile-ok');
        assert.match(idempotencyKey, /^local-agent:/);
        return { recordId: `ok-${source.numero}`, status: 'accepted' };
      },
    }),
  });

  const report = await worker.runDue({ limit: 10 });
  assert.equal(report.completed, 2);

  const settled = await settleWatchFolder({ store, root: layout.root });
  assert.equal(settled.settled.length, 1);
  assert.equal(settled.settled[0].state, 'completed');
  assert.equal((await readdir(layout.error)).length, 0);

  const processed = await readdir(layout.processed);
  assert.ok(processed.some((name) => name === 'ok.csv'));
  assert.ok(processed.some((name) => name === 'ok.csv.pv-manifest.json'));
  store.close();
});

test('watch-folder recovery resumes an orphan processing file without reissuing existing rows', async () => {
  const layout = await tempWatchRoot('pv-watch-recover-');
  const orphan = join(layout.processing, 'deadbeefdeadbeef--orphan.csv');
  await writeFile(orphan, 'numero,total\nC-1,30\n');

  const store = new LocalAgentStore(':memory:');
  const recovered = await recoverProcessingWatchFiles({
    store,
    root: layout.root,
    sourceId: 'watch-recover',
    profileId: 'profile-recover',
    issueEnabled: true,
    now: 9_000,
  });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].rows, 1);
  assert.equal(store.list().length, 1);

  const again = await recoverProcessingWatchFiles({
    store,
    root: layout.root,
    sourceId: 'watch-recover',
    profileId: 'profile-recover',
    issueEnabled: true,
    now: 10_000,
  });
  assert.equal(again.length, 0);
  assert.equal(store.list().length, 1);
  store.close();
});

test('mapped-source preflight failure never calls issue', async () => {
  let issued = 0;
  const transport = createPuenteApiTransport({
    async preflightMapped() {
      return { ok: false, summary: { rows: 1, valid: 0, invalid: 1 } };
    },
    async issueMapped() {
      issued += 1;
      return { recordId: 'must-not-exist' };
    },
  });

  await assert.rejects(
    () => transport(
      { kind: 'mapped-source', profileId: 'p1', source: { numero: 'BAD' } },
      { idempotencyKey: 'idem-preflight' },
    ),
    (error) => error.code === 'VF_LOCAL_AGENT_PREFLIGHT_FAILED'
      && error.retryable === false
      && error.status === 422,
  );
  assert.equal(issued, 0);
});
