import { fingerprintIntent, makeIdempotencyKey, sha256 } from './idempotency.mjs';

export class InMemoryIntentStore {
  #records = new Map();
  #events = [];

  put(intent) {
    const key = makeIdempotencyKey(intent);
    const fingerprint = fingerprintIntent(intent);
    const existing = this.#records.get(key);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return {
          status: 'conflict',
          code: 'VF_CONFLICT_IDEMPOTENCY_PAYLOAD',
          recordId: existing.recordId,
        };
      }
      return { status: 'duplicate', recordId: existing.recordId, record: structuredClone(existing) };
    }

    const recordId = `ir_${sha256(key).slice(0, 24)}`;
    const record = {
      recordId,
      idempotencyKey: key,
      fingerprint,
      state: 'received',
      intent: structuredClone(intent),
    };
    this.#records.set(key, record);
    this.#events.push({ recordId, type: 'intent.received', sequence: this.#events.length + 1 });
    return { status: 'created', recordId, record: structuredClone(record) };
  }

  get(recordId) {
    for (const record of this.#records.values()) {
      if (record.recordId === recordId) return structuredClone(record);
    }
    return null;
  }

  events() {
    return structuredClone(this.#events);
  }
}
