import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAgentStore } from '../src/store.mjs';
import { LocalAgentWorker, createPuenteApiTransport, retryDelayMs } from '../src/worker.mjs';
import { assertOutboundBaseUrl } from '../src/network.mjs';
import { createLocalAgentApiClient } from '../src/client.mjs';
import { scanWatchFolder } from '../src/watch-folder.mjs';

test('Local Agent queue is durable and source-key idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pv-local-agent-'));
  const dbPath = join(dir, 'agent.sqlite');
  const first = new LocalAgentStore(dbPath);
  if (process.platform !== 'win32') {
    assert.equal((await stat(dbPath)).mode & 0o777, 0o600);
  }
  const payload = { kind: 'invoice-intent', intent: { number: 'A-1' } };

  const job = first.enqueue({
    sourceId: 'erp-main',
    sourceKey: 'invoice-1',
    payload,
    now: 100,
    availableAt: 100,
  });
  const duplicate = first.enqueue({
    sourceId: 'erp-main',
    sourceKey: 'invoice-1',
    payload,
    now: 200,
    availableAt: 200,
  });

  assert.equal(duplicate.id, job.id);
  assert.equal(duplicate.idempotencyKey, job.idempotencyKey);
  assert.equal(first.stats(100).pending, 1);
  assert.throws(
    () => first.enqueue({
      sourceId: 'erp-main',
      sourceKey: 'invoice-1',
      payload: { kind: 'invoice-intent', intent: { number: 'DIFFERENT' } },
    }),
    (error) => error.code === 'VF_LOCAL_AGENT_SOURCE_KEY_CONFLICT',
  );
  first.close();

  const reopened = new LocalAgentStore(dbPath);
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.get(job.id).idempotencyKey, job.idempotencyKey);
  reopened.close();
});

test('Local Agent leases recover safely and checkpoints survive restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pv-local-agent-lease-'));
  const dbPath = join(dir, 'agent.sqlite');
  const store = new LocalAgentStore(dbPath);

  const queued = store.enqueue({
    sourceId: 'db-orders',
    sourceKey: '42',
    payload: { kind: 'mapped-source', profileId: 'profile-1', source: { id: 42 } },
    now: 1_000,
    availableAt: 1_000,
  });
  const claimed = store.claimNext({ owner: 'worker-a', now: 1_000, leaseMs: 1_000 });
  assert.equal(claimed.id, queued.id);
  assert.equal(claimed.state, 'processing');
  assert.equal(store.claimNext({ owner: 'worker-b', now: 1_500, leaseMs: 1_000 }), null);

  assert.equal(store.recoverExpired(2_001), 1);
  const reclaimed = store.claimNext({ owner: 'worker-b', now: 2_001, leaseMs: 1_000 });
  assert.equal(reclaimed.id, queued.id);
  assert.equal(reclaimed.idempotencyKey, queued.idempotencyKey);
  assert.equal(reclaimed.attempts, 2);

  store.setCheckpoint('db-orders', { lastId: 42 }, 2_100);
  store.close();

  const reopened = new LocalAgentStore(dbPath);
  assert.deepEqual(reopened.getCheckpoint('db-orders').cursor, { lastId: 42 });
  reopened.close();
});

test('Local Agent worker completes, retries and blocks without changing idempotency key', async () => {
  const store = new LocalAgentStore(':memory:');
  let now = 10_000;
  const calls = [];
  const worker = new LocalAgentWorker({
    store,
    owner: 'worker-test',
    leaseMs: 1_000,
    now: () => now,
    transport: async (payload, context) => {
      calls.push({ payload, context });
      if (payload.mode === 'retry') {
        const error = Object.assign(new Error('temporary'), { code: 'TEMP', retryable: true, status: 503 });
        throw error;
      }
      if (payload.mode === 'block') {
        const error = Object.assign(new Error('bad input'), { code: 'BAD_INPUT', retryable: false, status: 422 });
        throw error;
      }
      return { recordId: 'record-1', status: 'accepted' };
    },
  });

  const ok = store.enqueue({ sourceId: 'pos', sourceKey: '1', payload: { mode: 'ok' }, now, availableAt: now });
  const first = await worker.runOne();
  assert.equal(first.state, 'completed');
  assert.equal(first.recordId, 'record-1');
  assert.equal(calls[0].context.idempotencyKey, ok.idempotencyKey);

  const retry = store.enqueue({ sourceId: 'pos', sourceKey: '2', payload: { mode: 'retry' }, now, availableAt: now });
  const second = await worker.runOne();
  assert.equal(second.state, 'pending');
  assert.equal(second.availableAt, now + retryDelayMs(1));
  assert.equal(calls[1].context.idempotencyKey, retry.idempotencyKey);

  const blocked = store.enqueue({ sourceId: 'pos', sourceKey: '3', payload: { mode: 'block' }, now, availableAt: now });
  const third = await worker.runOne();
  assert.equal(third.state, 'blocked');
  assert.equal(third.error.code, 'BAD_INPUT');
  assert.equal(calls[2].context.idempotencyKey, blocked.idempotencyKey);
  store.close();
});

test('API transport always preflights before issue and reuses worker idempotency', async () => {
  const calls = [];
  const client = {
    async preflight(intent) { calls.push(['preflight', intent]); return { ok: true }; },
    async issue(intent, options) { calls.push(['issue', intent, options]); return { recordId: 'r-intent' }; },
    async preflightMapped(profileId, source) { calls.push(['preflightMapped', profileId, source]); return { ok: true }; },
    async issueMapped(profileId, source, options) { calls.push(['issueMapped', profileId, source, options]); return { recordId: 'r-mapped' }; },
  };
  const transport = createPuenteApiTransport(client);

  await transport({ kind: 'invoice-intent', intent: { number: 'A-1' } }, { idempotencyKey: 'idem-a' });
  await transport({ kind: 'mapped-source', profileId: 'p1', source: { id: 1 } }, { idempotencyKey: 'idem-b' });

  assert.deepEqual(calls[0], ['preflight', { number: 'A-1' }]);
  assert.deepEqual(calls[1], ['issue', { number: 'A-1' }, { idempotencyKey: 'idem-a' }]);
  assert.deepEqual(calls[2], ['preflightMapped', 'p1', { id: 1 }]);
  assert.deepEqual(calls[3], ['issueMapped', 'p1', { id: 1 }, { idempotencyKey: 'idem-b' }]);

  await assert.rejects(
    () => transport({ kind: 'watch-file' }, { idempotencyKey: 'idem-c' }),
    (error) => error.code === 'VF_LOCAL_AGENT_PAYLOAD_KIND_UNSUPPORTED' && error.retryable === false,
  );

  const networkTransport = createPuenteApiTransport({
    async preflight() {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(
    () => networkTransport({ kind: 'invoice-intent', intent: { number: 'A-2' } }, { idempotencyKey: 'idem-network' }),
    (error) => error.code === 'VF_LOCAL_AGENT_NETWORK_ERROR' && error.retryable === true,
  );
});

test('watch-folder discovery is deterministic and fingerprints file revisions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pv-watch-folder-'));
  await writeFile(join(dir, 'b.xlsx'), Buffer.from('xlsx-fixture'));
  await writeFile(join(dir, 'a.csv'), 'invoice,total\n1,10\n');
  await writeFile(join(dir, 'ignore.txt'), 'ignored');

  const firstScan = await scanWatchFolder(dir);
  assert.deepEqual(firstScan.map((file) => file.name), ['a.csv', 'b.xlsx']);
  assert.match(firstScan[0].sha256, /^[0-9a-f]{64}$/);
  const originalHash = firstScan[0].sha256;

  await writeFile(join(dir, 'a.csv'), 'invoice,total\n1,11\n');
  const secondScan = await scanWatchFolder(dir);
  assert.notEqual(secondScan[0].sha256, originalHash);
});

test('terminal payload redaction preserves source idempotency without retaining raw data', () => {
  const store = new LocalAgentStore(':memory:');
  const payload = {
    kind: 'mapped-source',
    profileId: 'p-redact',
    source: { numero: 'R-1', cliente: 'Dato sensible' },
  };
  const queued = store.enqueue({
    sourceId: 'watch-redact',
    sourceKey: 'filehash:row:2',
    payload,
    now: 100,
    availableAt: 100,
  });
  const claimed = store.claimNext({ owner: 'redact-worker', now: 100, leaseMs: 1_000 });
  store.complete(claimed.id, {
    owner: 'redact-worker',
    recordId: 'record-redact',
    result: { recordId: 'record-redact', presentation: { url: 'sensitive-result' } },
    now: 200,
  });

  const redacted = store.redactTerminal(queued.id);
  assert.equal(redacted.redacted, true);
  assert.equal(redacted.payload, null);
  assert.equal(redacted.result, null);
  assert.equal(redacted.recordId, 'record-redact');
  assert.equal(redacted.idempotencyKey, queued.idempotencyKey);

  const duplicate = store.enqueue({
    sourceId: 'watch-redact',
    sourceKey: 'filehash:row:2',
    payload,
    now: 300,
    availableAt: 300,
  });
  assert.equal(duplicate.id, queued.id);
  assert.equal(duplicate.state, 'completed');
  assert.equal(duplicate.redacted, true);

  assert.throws(
    () => store.enqueue({
      sourceId: 'watch-redact',
      sourceKey: 'filehash:row:2',
      payload: { ...payload, source: { numero: 'R-1', cliente: 'Otro dato' } },
      now: 400,
      availableAt: 400,
    }),
    (error) => error.code === 'VF_LOCAL_AGENT_SOURCE_KEY_CONFLICT',
  );

  assert.deepEqual(store.redactTerminalPayloads({ before: 500 }), { redacted: 0, ids: [] });
  store.close();
});

test('Local Agent network policy requires outbound HTTPS except explicit localhost development', () => {
  assert.equal(assertOutboundBaseUrl('https://kairoseth.example/api/'), 'https://kairoseth.example/api');
  assert.throws(
    () => assertOutboundBaseUrl('http://kairoseth.example/api'),
    (error) => error.code === 'VF_LOCAL_AGENT_HTTPS_REQUIRED',
  );
  assert.equal(
    assertOutboundBaseUrl('http://127.0.0.1:3000', { allowInsecureLocalhost: true }),
    'http://127.0.0.1:3000',
  );
  assert.throws(
    () => assertOutboundBaseUrl('https://user:secret@kairoseth.example'),
    (error) => error.code === 'VF_LOCAL_AGENT_URL_CREDENTIALS_FORBIDDEN',
  );

  assert.throws(
    () => createLocalAgentApiClient({ baseUrl: 'http://kairoseth.example', apiKey: 'test-key' }),
    (error) => error.code === 'VF_LOCAL_AGENT_HTTPS_REQUIRED',
  );
  const client = createLocalAgentApiClient({
    baseUrl: 'https://kairoseth.example/',
    apiKey: 'test-key',
    fetchImpl: async () => {
      throw new Error('not called');
    },
  });
  assert.equal(client.baseUrl, 'https://kairoseth.example');
  assert.equal(client.connectorVersion, 'local-agent-v1');
});
