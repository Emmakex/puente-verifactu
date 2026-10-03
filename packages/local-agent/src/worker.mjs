import { randomUUID } from 'node:crypto';

function serializeError(error) {
  return {
    code: String(error?.code ?? 'VF_LOCAL_AGENT_TRANSPORT_ERROR'),
    message: String(error?.message ?? 'Local Agent transport failed').slice(0, 500),
    retryable: Boolean(error?.retryable),
    status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null,
  };
}

function normalizeTransportError(error) {
  if (typeof error?.retryable === 'boolean' || error?.code) return error;
  if (error instanceof TypeError) {
    return Object.assign(error, {
      code: 'VF_LOCAL_AGENT_NETWORK_ERROR',
      retryable: true,
    });
  }
  return error;
}

export function retryDelayMs(attempt) {
  const normalized = Math.max(1, Number(attempt) || 1);
  return Math.min(15 * 60_000, 5_000 * (2 ** Math.min(8, normalized - 1)));
}

export class LocalAgentWorker {
  constructor({
    store,
    transport,
    owner = `local-agent-${randomUUID()}`,
    leaseMs = 60_000,
    maxAttempts = 12,
    now = () => Date.now(),
  } = {}) {
    if (!store) throw new TypeError('store is required');
    if (typeof transport !== 'function') throw new TypeError('transport must be a function');
    this.store = store;
    this.transport = transport;
    this.owner = owner;
    this.leaseMs = leaseMs;
    this.maxAttempts = maxAttempts;
    this.now = now;
  }

  async runOne() {
    const now = this.now();
    const job = this.store.claimNext({ owner: this.owner, now, leaseMs: this.leaseMs });
    if (!job) return null;

    try {
      const result = await this.transport(job.payload, {
        idempotencyKey: job.idempotencyKey,
        sourceId: job.sourceId,
        sourceKey: job.sourceKey,
      });
      return this.store.complete(job.id, {
        owner: this.owner,
        recordId: result?.recordId ?? result?.record?.recordId ?? null,
        result: result ?? null,
        now: this.now(),
      });
    } catch (error) {
      const failure = serializeError(error);
      if (failure.retryable && job.attempts < this.maxAttempts) {
        const current = this.now();
        return this.store.retry(job.id, {
          owner: this.owner,
          availableAt: current + retryDelayMs(job.attempts),
          error: failure,
          now: current,
        });
      }
      return this.store.block(job.id, {
        owner: this.owner,
        error: failure,
        now: this.now(),
      });
    }
  }

  async runDue({ limit = 50 } = {}) {
    const maximum = Math.max(1, Math.min(1_000, Number(limit) || 50));
    const jobs = [];
    for (let index = 0; index < maximum; index += 1) {
      const job = await this.runOne();
      if (!job) break;
      jobs.push(job);
    }
    return Object.freeze({
      processed: jobs.length,
      completed: jobs.filter((job) => job.state === 'completed').length,
      pending: jobs.filter((job) => job.state === 'pending').length,
      blocked: jobs.filter((job) => job.state === 'blocked').length,
      jobs: Object.freeze(jobs),
    });
  }
}

export function createPuenteApiTransport(client) {
  if (!client) throw new TypeError('Puente API client is required');
  return async function transport(payload, { idempotencyKey } = {}) {
    try {
      if (payload?.kind === 'invoice-intent') {
        await client.preflight(payload.intent);
        return await client.issue(payload.intent, { idempotencyKey });
      }
      if (payload?.kind === 'mapped-source') {
        await client.preflightMapped(payload.profileId, payload.source);
        return await client.issueMapped(payload.profileId, payload.source, { idempotencyKey });
      }
      throw Object.assign(new Error('Unsupported Local Agent payload kind'), {
        code: 'VF_LOCAL_AGENT_PAYLOAD_KIND_UNSUPPORTED',
        retryable: false,
      });
    } catch (error) {
      throw normalizeTransportError(error);
    }
  };
}
