import { buildChainKey, createAltaFiscalRecord, createAnulacionFiscalRecord, fiscalOperationFingerprint, verifyFiscalRecord } from './fiscal-records.mjs';
import { timestampForZone } from './hash.mjs';
import { MemoryFiscalRecordStore } from './fiscal-record-store.mjs';

function conflict(message) {
  return Object.assign(new Error(message), { code: 'VF_FISCAL_IDEMPOTENCY_CONFLICT' });
}

export class FiscalRecordService {
  constructor({ sif, store = new MemoryFiscalRecordStore(), clock = () => new Date() }) {
    this.sif = sif;
    this.store = store;
    this.clock = clock;
  }

  generatedAt(options) {
    return options?.generatedAt ?? timestampForZone(this.clock(), this.sif?.timeZone);
  }

  async executeOperation({
    chainKey,
    operationKey,
    payload,
    createRecord,
  }) {
    const fingerprint = fiscalOperationFingerprint(payload);
    if (typeof this.store?.executeOperation === 'function') {
      return this.store.executeOperation({
        chainKey,
        operationKey,
        fingerprint,
        createRecord,
      });
    }

    return this.store.transact(chainKey, ({ last, findOperation, append }) => {
      const existing = findOperation(operationKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw conflict('Same fiscal operation identity received with different fiscal content');
        }
        return { record: existing.record, duplicate: true };
      }
      const record = createRecord(last);
      append(record, { operationKey, operationPayload: payload });
      return { record, duplicate: false };
    });
  }

  async issue(intent, options) {
    const chainKey = buildChainKey(intent.organizationId, this.sif);
    const operationKey = `issue\u001f${chainKey}\u001f${intent.installationId}\u001f${intent.sourceSystem}\u001f${intent.sourceInvoiceId}`;
    const { sourceMetadata: _ignored, ...fiscalIntent } = intent;
    const payload = { intent: fiscalIntent, euroAmounts: options?.euroAmounts ?? null };

    return this.executeOperation({
      chainKey,
      operationKey,
      payload,
      createRecord: (previous) => createAltaFiscalRecord(intent, {
        ...options,
        generatedAt: this.generatedAt(options),
        sif: this.sif,
        previous,
      }),
    });
  }

  async cancel(request, options) {
    if (!request?.sourceCancellationId) throw new TypeError('sourceCancellationId is required for cancellation idempotency');
    const chainKey = buildChainKey(request.organizationId, this.sif);
    const operationKey = `cancel\u001f${chainKey}\u001f${request.sourceCancellationId}`;
    const payload = request;

    return this.executeOperation({
      chainKey,
      operationKey,
      payload,
      createRecord: (previous) => createAnulacionFiscalRecord(request, {
        ...options,
        generatedAt: this.generatedAt(options),
        sif: this.sif,
        previous,
      }),
    });
  }
}

export function verifyFiscalChain(records) {
  const errors = [];
  records.forEach((record, index) => {
    const expectedSequence = index + 1;
    if (record.sequence !== expectedSequence) errors.push({ index, code: 'VF_CHAIN_SEQUENCE_INVALID' });
    const previous = records[index - 1] ?? null;
    if (!previous && !record.firstRecord) errors.push({ index, code: 'VF_CHAIN_FIRST_FLAG_INVALID' });
    if (previous) {
      if (record.firstRecord) errors.push({ index, code: 'VF_CHAIN_FIRST_FLAG_INVALID' });
      if (record.previous?.hash !== previous.hash) errors.push({ index, code: 'VF_CHAIN_LINK_INVALID' });
      if (Date.parse(record.generatedAt) < Date.parse(previous.generatedAt)) errors.push({ index, code: 'VF_CHAIN_TIME_ORDER_INVALID' });
    }
    const hash = verifyFiscalRecord(record);
    if (!hash.ok) errors.push({ index, code: 'VF_CHAIN_HASH_INVALID', expected: hash.expected, actual: hash.actual });
  });
  return { ok: errors.length === 0, errors };
}
