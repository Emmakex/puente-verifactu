import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AeatOutboxWorker } from '../../aeat-adapter/src/outbox.mjs';
import { createSqlitePersistence } from '../src/index.mjs';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'puente-verifactu-aeat-outbox-'));
  return {
    directory,
    path: join(directory, 'puente.sqlite'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

const payload = {
  issuer: { name: 'Empresa Demo', taxId: 'B12345678' },
  entries: [{
    intent: { sourceInvoiceId: 'INV-1' },
    record: { hash: 'A'.repeat(64) },
  }],
};

test('durable AEAT outbox survives restart and dispatches a pending job once', async () => {
  const files = fixture();
  try {
    let persistence = createSqlitePersistence({ path: files.path });
    const queued = persistence.aeatOutbox.enqueue(payload, { id: 'aeat_restart_1', availableAt: 1000, now: 1000 });
    assert.equal(queued.state, 'pending');
    persistence.close();

    let calls = 0;
    persistence = createSqlitePersistence({ path: files.path });
    const worker = new AeatOutboxWorker({
      outbox: persistence.aeatOutbox,
      adapter: {
        submit: async () => {
          calls += 1;
          return { kind: 'aeat_response', status: 'accepted', retryable: false, records: [{ status: 'accepted' }] };
        },
      },
      clock: () => 1000,
      workerId: 'worker-restart',
    });

    const results = await worker.runDue();
    assert.equal(results.length, 1);
    assert.equal(results[0].state, 'completed');
    assert.equal(results[0].attempts, 1);
    assert.equal(calls, 1);
    persistence.close();

    persistence = createSqlitePersistence({ path: files.path });
    assert.equal(persistence.aeatOutbox.get('aeat_restart_1').state, 'completed');
    persistence.close();
  } finally {
    files.cleanup();
  }
});

test('expired dispatch lease becomes reconciliation_required after restart and is never blindly resent', async () => {
  const files = fixture();
  try {
    let persistence = createSqlitePersistence({ path: files.path });
    persistence.aeatOutbox.enqueue(payload, { id: 'aeat_crash_1', availableAt: 0, now: 0 });
    const claimed = persistence.aeatOutbox.claim('aeat_crash_1', { owner: 'dead-worker', now: 0, leaseMs: 100 });
    assert.equal(claimed.state, 'processing');
    assert.equal(claimed.attempts, 1);
    persistence.close();

    let calls = 0;
    persistence = createSqlitePersistence({ path: files.path });
    const worker = new AeatOutboxWorker({
      outbox: persistence.aeatOutbox,
      adapter: { submit: async () => { calls += 1; return { status: 'accepted', retryable: false }; } },
      clock: () => 101,
      workerId: 'recovery-worker',
    });
    const recovered = await worker.run('aeat_crash_1');
    assert.equal(recovered.state, 'reconciliation_required');
    assert.equal(recovered.lastResult.reason, 'lease_expired_after_dispatch_start');
    assert.equal(calls, 0);
    persistence.close();
  } finally {
    files.cleanup();
  }
});

test('transport outcome is quarantined until an explicit reconciliation decision', async () => {
  const persistence = createSqlitePersistence({ path: ':memory:' });
  try {
    let now = 0;
    let calls = 0;
    const adapter = {
      submit: async () => {
        calls += 1;
        if (calls === 1) return { kind: 'transport_error', status: 'fault', retryable: true, errorCode: 'ETIMEDOUT' };
        return { kind: 'aeat_response', status: 'accepted', retryable: false, records: [{ status: 'accepted' }] };
      },
    };
    persistence.aeatOutbox.enqueue(payload, { id: 'aeat_uncertain_1', availableAt: 0, now: 0 });
    const worker = new AeatOutboxWorker({ outbox: persistence.aeatOutbox, adapter, clock: () => now, workerId: 'worker-1' });

    const uncertain = await worker.run('aeat_uncertain_1');
    assert.equal(uncertain.state, 'reconciliation_required');
    assert.equal(uncertain.lastResult.reason, 'transport_outcome_unknown');
    assert.equal(calls, 1);

    now = 60000;
    const stillQuarantined = await worker.run('aeat_uncertain_1');
    assert.equal(stillQuarantined.state, 'reconciliation_required');
    assert.equal(calls, 1);

    persistence.aeatOutbox.resolveReconciliation('aeat_uncertain_1', {
      action: 'retry',
      availableAt: now,
      now,
      result: { kind: 'manual_reconciliation', outcome: 'confirmed_not_received' },
    });
    const completed = await worker.run('aeat_uncertain_1');
    assert.equal(completed.state, 'completed');
    assert.equal(completed.attempts, 2);
    assert.equal(calls, 2);
  } finally {
    persistence.close();
  }
});

test('an active lease prevents a second worker from dispatching the same job', async () => {
  const persistence = createSqlitePersistence({ path: ':memory:' });
  try {
    persistence.aeatOutbox.enqueue(payload, { id: 'aeat_lease_1', availableAt: 0, now: 0 });
    const firstClaim = persistence.aeatOutbox.claim('aeat_lease_1', { owner: 'worker-a', now: 0, leaseMs: 1000 });
    assert.equal(firstClaim.state, 'processing');

    let calls = 0;
    const secondWorker = new AeatOutboxWorker({
      outbox: persistence.aeatOutbox,
      adapter: { submit: async () => { calls += 1; return { status: 'accepted', retryable: false }; } },
      clock: () => 500,
      workerId: 'worker-b',
    });
    const observed = await secondWorker.run('aeat_lease_1');
    assert.equal(observed.state, 'processing');
    assert.equal(observed.leaseOwner, 'worker-a');
    assert.equal(calls, 0);
  } finally {
    persistence.close();
  }
});


test('AEAT outbox worker supports a fully asynchronous store contract', async () => {
  const jobs = new Map();
  const asyncStore = {
    async enqueue(input, { id = 'async-job', availableAt = 0, now = 0 } = {}) {
      const job = {
        id,
        payload: structuredClone(input),
        state: 'pending',
        attempts: 0,
        availableAt,
        lastResult: null,
        leaseOwner: null,
        leaseUntil: null,
        createdAt: now,
        updatedAt: now,
      };
      jobs.set(id, job);
      return structuredClone(job);
    },
    async get(id) {
      return jobs.has(id) ? structuredClone(jobs.get(id)) : null;
    },
    async list() {
      return [...jobs.values()].map((job) => structuredClone(job));
    },
    async recoverExpired() { return 0; },
    async claim(id, { owner, now, leaseMs }) {
      const job = jobs.get(id);
      if (!job || job.state !== 'pending' || job.availableAt > now) return null;
      const claimed = {
        ...job,
        state: 'processing',
        attempts: job.attempts + 1,
        leaseOwner: owner,
        leaseUntil: now + leaseMs,
        updatedAt: now,
      };
      jobs.set(id, claimed);
      return structuredClone(claimed);
    },
    async settle(id, { owner, state, availableAt = null, lastResult = null, now = 0 }) {
      const job = jobs.get(id);
      if (!job || job.state !== 'processing' || job.leaseOwner !== owner) {
        throw Object.assign(new Error('lease lost'), { code: 'VF_AEAT_OUTBOX_LEASE_LOST' });
      }
      const settled = {
        ...job,
        state,
        availableAt: availableAt ?? job.availableAt,
        lastResult,
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: now,
      };
      jobs.set(id, settled);
      return structuredClone(settled);
    },
  };

  await asyncStore.enqueue(payload, { id: 'async-aeat-1', availableAt: 0, now: 0 });
  let calls = 0;
  const worker = new AeatOutboxWorker({
    outbox: asyncStore,
    adapter: {
      async submit() {
        calls += 1;
        return {
          kind: 'aeat_response',
          status: 'accepted',
          retryable: false,
          records: [{ status: 'accepted' }],
        };
      },
    },
    clock: () => 1000,
    workerId: 'async-worker',
  });

  const result = await worker.run('async-aeat-1');
  assert.equal(result.state, 'completed');
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
});
