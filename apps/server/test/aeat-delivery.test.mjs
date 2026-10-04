import test from 'node:test';
import assert from 'node:assert/strict';
import { createAeatDeliveryQueue } from '../src/aeat-delivery.mjs';

function outboxFixture() {
  const jobs = new Map();
  return {
    jobs,
    async enqueue(payload, { id }) {
      if (!jobs.has(id)) {
        jobs.set(id, {
          id,
          payload: structuredClone(payload),
          state: 'pending',
          attempts: 0,
          lastResult: null,
        });
      }
      return structuredClone(jobs.get(id));
    },
    async get(id) {
      const job = jobs.get(id);
      return job ? structuredClone(job) : null;
    },
  };
}

test('AEAT delivery queue persists an alta payload with deterministic job identity', async () => {
  const outbox = outboxFixture();
  const queue = createAeatDeliveryQueue({ outbox });
  const intent = {
    issuer: { name: 'Empresa Demo', taxId: '89890001K' },
    sourceInvoiceId: 'INV-1',
  };
  const record = {
    recordType: 'alta',
    invoice: { issuerTaxId: '89890001K' },
    hash: 'abc',
  };

  const result = await queue.enqueue({
    intent,
    record,
    recordId: 'fr_abc',
  });

  assert.equal(result.status, 'queued');
  assert.equal(result.jobId, 'aeat_fr_abc');
  const stored = outbox.jobs.get('aeat_fr_abc');
  assert.equal(stored.payload.issuer.name, 'Empresa Demo');
  assert.equal(stored.payload.entries[0].intent.sourceInvoiceId, 'INV-1');
  assert.equal(stored.payload.entries[0].record.hash, 'abc');
});

test('AEAT delivery status resolves the current durable outbox state', async () => {
  const outbox = outboxFixture();
  const queue = createAeatDeliveryQueue({ outbox });
  await queue.enqueue({
    intent: { issuer: { name: 'Empresa Demo', taxId: '89890001K' } },
    record: {
      recordType: 'alta',
      invoice: { issuerTaxId: '89890001K' },
    },
    recordId: 'fr_state',
  });

  const job = outbox.jobs.get('aeat_fr_state');
  job.state = 'completed';
  job.attempts = 1;
  job.lastResult = { kind: 'aeat_response', status: 'accepted' };

  const result = await queue.resolve({ jobId: 'aeat_fr_state', status: 'queued' });
  assert.equal(result.status, 'completed');
  assert.equal(result.attempts, 1);
  assert.equal(result.reconciliationRequired, false);
});

test('AEAT cancellation delivery requires explicit issuer context', async () => {
  const outbox = outboxFixture();
  const queue = createAeatDeliveryQueue({ outbox });
  await assert.rejects(
    () => queue.enqueue({
      record: {
        recordType: 'anulacion',
        invoice: { issuerTaxId: '89890001K' },
      },
      recordId: 'fr_cancel',
    }),
    (error) => error.code === 'VF_AEAT_DELIVERY_CONTEXT_INVALID',
  );

  const result = await queue.enqueue({
    issuer: { name: 'Empresa Demo', taxId: '89890001K' },
    record: {
      recordType: 'anulacion',
      invoice: { issuerTaxId: '89890001K' },
    },
    recordId: 'fr_cancel',
  });
  assert.equal(result.status, 'queued');
  assert.equal(outbox.jobs.get('aeat_fr_cancel').payload.entries[0].record.recordType, 'anulacion');
});
