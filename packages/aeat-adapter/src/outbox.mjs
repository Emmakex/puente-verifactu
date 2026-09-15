import { randomUUID } from 'node:crypto';

function backoffMs(attempt, baseMs, maxMs) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

function immutableJob(job) {
  return job == null ? null : Object.freeze(structuredClone(job));
}

function reconciliationResult(reason, previous = null) {
  return {
    kind: 'reconciliation_required',
    status: 'unknown',
    retryable: false,
    reason,
    previous,
  };
}

export class MemoryAeatOutbox {
  #jobs = new Map();

  enqueue(payload, { availableAt = Date.now(), id = `aeat_${randomUUID()}` } = {}) {
    if (this.#jobs.has(id)) return this.get(id);
    const now = Date.now();
    const job = {
      id,
      payload: structuredClone(payload),
      state: 'pending',
      attempts: 0,
      availableAt,
      lastResult: null,
      leaseOwner: null,
      leaseUntil: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#jobs.set(id, job);
    return immutableJob(job);
  }

  get(id) {
    return immutableJob(this.#jobs.get(id) ?? null);
  }

  list() {
    return [...this.#jobs.values()]
      .sort((a, b) => a.availableAt - b.availableAt || a.id.localeCompare(b.id))
      .map(immutableJob);
  }

  claim(id, { owner, now, leaseMs }) {
    const job = this.#jobs.get(id);
    if (!job || job.state !== 'pending' || job.availableAt > now) return null;
    const claimed = {
      ...job,
      state: 'processing',
      attempts: job.attempts + 1,
      leaseOwner: owner,
      leaseUntil: now + leaseMs,
      updatedAt: now,
    };
    this.#jobs.set(id, claimed);
    return immutableJob(claimed);
  }

  settle(id, { owner, state, availableAt = null, lastResult = null, now = Date.now() }) {
    const job = this.#jobs.get(id);
    if (!job || job.state !== 'processing' || job.leaseOwner !== owner) {
      throw Object.assign(new Error('AEAT outbox lease is no longer owned by this worker'), { code: 'VF_AEAT_OUTBOX_LEASE_LOST' });
    }
    const settled = {
      ...job,
      state,
      availableAt: availableAt ?? job.availableAt,
      lastResult: structuredClone(lastResult),
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: now,
    };
    this.#jobs.set(id, settled);
    return immutableJob(settled);
  }

  recoverExpired(now = Date.now()) {
    let recovered = 0;
    for (const [id, job] of this.#jobs.entries()) {
      if (job.state !== 'processing' || job.leaseUntil == null || job.leaseUntil > now) continue;
      this.#jobs.set(id, {
        ...job,
        state: 'reconciliation_required',
        lastResult: reconciliationResult('lease_expired_after_dispatch_start', job.lastResult),
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: now,
      });
      recovered += 1;
    }
    return recovered;
  }

  resolveReconciliation(id, { action, availableAt = Date.now(), result = null, now = Date.now() }) {
    const job = this.#jobs.get(id);
    if (!job) throw Object.assign(new Error('Outbox job not found'), { code: 'VF_AEAT_OUTBOX_JOB_NOT_FOUND' });
    if (job.state !== 'reconciliation_required') {
      throw Object.assign(new Error('Outbox job is not awaiting reconciliation'), { code: 'VF_AEAT_OUTBOX_NOT_RECONCILABLE' });
    }
    const state = action === 'retry' ? 'pending' : action === 'complete' ? 'completed' : action === 'block' ? 'blocked' : null;
    if (!state) throw Object.assign(new Error('Unsupported reconciliation action'), { code: 'VF_AEAT_OUTBOX_RECONCILIATION_ACTION_INVALID' });
    const resolved = {
      ...job,
      state,
      availableAt: action === 'retry' ? availableAt : job.availableAt,
      lastResult: structuredClone(result ?? { kind: 'manual_reconciliation', action }),
      updatedAt: now,
    };
    this.#jobs.set(id, resolved);
    return immutableJob(resolved);
  }
}

export class AeatOutboxWorker {
  constructor({
    adapter,
    outbox,
    clock = () => Date.now(),
    workerId = `worker_${randomUUID()}`,
    leaseMs = 30000,
    maxAttempts = 5,
    baseBackoffMs = 1000,
    maxBackoffMs = 60000,
  }) {
    this.adapter = adapter;
    this.outbox = outbox;
    this.clock = clock;
    this.workerId = workerId;
    this.leaseMs = leaseMs;
    this.maxAttempts = maxAttempts;
    this.baseBackoffMs = baseBackoffMs;
    this.maxBackoffMs = maxBackoffMs;
  }

  async run(jobId) {
    const now = this.clock();
    this.outbox.recoverExpired?.(now);
    const existing = this.outbox.get(jobId);
    if (!existing) throw Object.assign(new Error('Outbox job not found'), { code: 'VF_AEAT_OUTBOX_JOB_NOT_FOUND' });
    if (['completed', 'blocked', 'reconciliation_required', 'processing'].includes(existing.state)) return existing;
    if (now < existing.availableAt) return existing;

    const job = this.outbox.claim(jobId, { owner: this.workerId, now, leaseMs: this.leaseMs });
    if (!job) return this.outbox.get(jobId);

    let result;
    try {
      result = await this.adapter.submit(job.payload);
    } catch (error) {
      if (error.code === 'VF_AEAT_THROTTLED') {
        return this.outbox.settle(job.id, {
          owner: this.workerId,
          state: 'pending',
          availableAt: error.retryAt,
          lastResult: { kind: 'throttled', retryAt: error.retryAt },
          now: this.clock(),
        });
      }
      return this.outbox.settle(job.id, {
        owner: this.workerId,
        state: 'reconciliation_required',
        lastResult: reconciliationResult('adapter_exception_after_dispatch_start', {
          errorCode: error.code ?? 'VF_AEAT_WORKER_ERROR',
          message: error.message,
        }),
        now: this.clock(),
      });
    }

    if (result?.kind === 'transport_error') {
      return this.outbox.settle(job.id, {
        owner: this.workerId,
        state: 'reconciliation_required',
        lastResult: reconciliationResult('transport_outcome_unknown', result),
        now: this.clock(),
      });
    }

    if (!result?.retryable) {
      return this.outbox.settle(job.id, {
        owner: this.workerId,
        state: result?.status === 'accepted' || result?.status === 'partial' || result?.status === 'rejected' ? 'completed' : 'blocked',
        lastResult: result,
        now: this.clock(),
      });
    }

    if (job.attempts >= this.maxAttempts) {
      return this.outbox.settle(job.id, {
        owner: this.workerId,
        state: 'blocked',
        lastResult: result,
        now: this.clock(),
      });
    }

    const delay = result.waitSeconds != null
      ? result.waitSeconds * 1000
      : backoffMs(job.attempts, this.baseBackoffMs, this.maxBackoffMs);
    return this.outbox.settle(job.id, {
      owner: this.workerId,
      state: 'pending',
      availableAt: this.clock() + delay,
      lastResult: result,
      now: this.clock(),
    });
  }

  async runDue({ limit = 100 } = {}) {
    const now = this.clock();
    this.outbox.recoverExpired?.(now);
    const due = this.outbox.list()
      .filter((job) => job.state === 'pending' && job.availableAt <= now)
      .slice(0, limit);
    const results = [];
    for (const job of due) results.push(await this.run(job.id));
    return results;
  }
}
