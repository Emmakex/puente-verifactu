function backoffMs(attempt, baseMs, maxMs) {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

export class MemoryAeatOutbox {
  #jobs = new Map();
  #counter = 0;

  enqueue(payload, { availableAt = Date.now() } = {}) {
    const id = `aeat_${++this.#counter}`;
    const job = Object.freeze({
      id,
      payload,
      state: 'pending',
      attempts: 0,
      availableAt,
      lastResult: null,
    });
    this.#jobs.set(id, job);
    return job;
  }

  get(id) {
    return this.#jobs.get(id) ?? null;
  }

  list() {
    return [...this.#jobs.values()];
  }

  replace(job) {
    this.#jobs.set(job.id, Object.freeze(job));
    return this.#jobs.get(job.id);
  }
}

export class AeatOutboxWorker {
  constructor({ adapter, outbox, clock = () => Date.now(), maxAttempts = 5, baseBackoffMs = 1000, maxBackoffMs = 60000 }) {
    this.adapter = adapter;
    this.outbox = outbox;
    this.clock = clock;
    this.maxAttempts = maxAttempts;
    this.baseBackoffMs = baseBackoffMs;
    this.maxBackoffMs = maxBackoffMs;
  }

  async run(jobId) {
    const job = this.outbox.get(jobId);
    if (!job) throw Object.assign(new Error('Outbox job not found'), { code: 'VF_AEAT_OUTBOX_JOB_NOT_FOUND' });
    if (['completed', 'blocked'].includes(job.state)) return job;
    if (this.clock() < job.availableAt) return job;

    const attempt = job.attempts + 1;
    let result;
    try {
      result = await this.adapter.submit(job.payload);
    } catch (error) {
      if (error.code === 'VF_AEAT_THROTTLED') {
        return this.outbox.replace({ ...job, state: 'pending', availableAt: error.retryAt, lastResult: { kind: 'throttled', retryAt: error.retryAt } });
      }
      result = { kind: 'worker_error', status: 'fault', retryable: true, errorCode: error.code ?? 'VF_AEAT_WORKER_ERROR', message: error.message };
    }

    if (!result.retryable) {
      return this.outbox.replace({
        ...job,
        state: result.status === 'accepted' || result.status === 'partial' || result.status === 'rejected' ? 'completed' : 'blocked',
        attempts: attempt,
        lastResult: result,
      });
    }

    if (attempt >= this.maxAttempts) {
      return this.outbox.replace({ ...job, state: 'blocked', attempts: attempt, lastResult: result });
    }

    const delay = result.waitSeconds != null
      ? result.waitSeconds * 1000
      : backoffMs(attempt, this.baseBackoffMs, this.maxBackoffMs);
    return this.outbox.replace({
      ...job,
      state: 'pending',
      attempts: attempt,
      availableAt: this.clock() + delay,
      lastResult: result,
    });
  }
}
