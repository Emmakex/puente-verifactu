import { fiscalOperationFingerprint } from './fiscal-records.mjs';

class KeyedMutex {
  #tails = new Map();

  async runExclusive(key, operation) {
    const prior = this.#tails.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = prior.then(() => gate);
    this.#tails.set(key, tail);
    await prior;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

export function assertFiscalAppend(previous, record, expectedSequence) {
  if (record.sequence !== expectedSequence) {
    throw Object.assign(new Error('Fiscal sequence mismatch'), { code: 'VF_CHAIN_SEQUENCE_CONFLICT' });
  }
  if (!previous && !record.firstRecord) {
    throw Object.assign(new Error('First record flag mismatch'), { code: 'VF_CHAIN_FIRST_RECORD_CONFLICT' });
  }
  if (previous && record.firstRecord) {
    throw Object.assign(new Error('Only the first chain record can be marked firstRecord'), { code: 'VF_CHAIN_FIRST_RECORD_CONFLICT' });
  }
  if (previous && record.invoice.issuerTaxId !== previous.invoice.issuerTaxId) {
    throw Object.assign(new Error('A chain cannot mix different taxpayer issuers'), { code: 'VF_CHAIN_ISSUER_CONFLICT' });
  }
  if (previous && record.previous?.hash !== previous.hash) {
    throw Object.assign(new Error('Previous hash mismatch'), { code: 'VF_CHAIN_PREVIOUS_HASH_CONFLICT' });
  }
  if (previous && Date.parse(record.generatedAt) < Date.parse(previous.generatedAt)) {
    throw Object.assign(new Error('Generation timestamp moved backwards'), { code: 'VF_CHAIN_TIME_ORDER_CONFLICT' });
  }
  return record;
}

export class MemoryFiscalRecordStore {
  #chains = new Map();
  #operations = new Map();
  #mutex = new KeyedMutex();

  async transact(chainKey, operation) {
    return this.#mutex.runExclusive(chainKey, () => operation({
      last: this.last(chainKey),
      findOperation: (operationKey) => this.#operations.get(operationKey) ?? null,
      append: (record, { operationKey, operationPayload }) => this.#append(record, { operationKey, operationPayload }),
    }));
  }

  last(chainKey) {
    return this.#chains.get(chainKey)?.at(-1) ?? null;
  }

  list(chainKey) {
    return [...(this.#chains.get(chainKey) ?? [])];
  }

  #append(record, { operationKey, operationPayload }) {
    const chain = this.#chains.get(record.chainKey) ?? [];
    const previous = chain.at(-1) ?? null;
    assertFiscalAppend(previous, record, chain.length + 1);
    chain.push(record);
    this.#chains.set(record.chainKey, chain);
    this.#operations.set(operationKey, { record, fingerprint: fiscalOperationFingerprint(operationPayload) });
    return record;
  }
}
