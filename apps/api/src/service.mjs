import { createHash } from 'node:crypto';
import { applyMapping } from '../../../packages/core/src/mapping.mjs';
import { stableStringify } from '../../../packages/core/src/idempotency.mjs';
import { validateInvoiceIntent } from '../../../packages/core/src/validation.mjs';

function apiError(code, message, status = 400, details = []) {
  return Object.assign(new Error(message), { code, status, details });
}

function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export class MemoryIntegrationStore {
  constructor() {
    this.records = new Map();
    this.requests = new Map();
  }

  get(recordId) {
    return this.records.get(recordId) ?? null;
  }

  put(record) {
    const frozen = Object.freeze(structuredClone(record));
    this.records.set(record.recordId, frozen);
    return frozen;
  }

  reserve(key, payload) {
    const existing = this.requests.get(key);
    const payloadFingerprint = fingerprint(payload);
    if (existing) {
      if (existing.fingerprint !== payloadFingerprint) {
        throw apiError('VF_API_IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used with different content', 409);
      }
      return { existing, duplicate: true };
    }
    const pending = { fingerprint: payloadFingerprint, recordId: null };
    this.requests.set(key, pending);
    return { existing: pending, duplicate: false };
  }

  complete(key, payload, recordId) {
    this.requests.set(key, { fingerprint: fingerprint(payload), recordId });
  }

  release(key, payload) {
    const existing = this.requests.get(key);
    if (existing?.recordId == null && existing.fingerprint === fingerprint(payload)) this.requests.delete(key);
  }
}

function requireContext(context) {
  for (const field of ['organizationId', 'installationId', 'sourceSystem']) {
    if (!context?.[field] || typeof context[field] !== 'string') {
      throw apiError('VF_API_AUTH_CONTEXT_INVALID', `Authenticated context is missing ${field}`, 500);
    }
  }
  return context;
}

export function stampServerIdentity(input, context) {
  requireContext(context);
  const intent = structuredClone(input ?? {});
  intent.schemaVersion = 1;
  intent.operation = 'issue';
  intent.organizationId = context.organizationId;
  intent.installationId = context.installationId;
  intent.sourceSystem = context.sourceSystem;
  return intent;
}

function assertValid(intent) {
  const validation = validateInvoiceIntent(intent);
  if (!validation.ok) {
    throw apiError('VF_API_VALIDATION_FAILED', 'InvoiceIntent validation failed', 422, validation.errors);
  }
  return validation;
}

function recordIdFor(record) {
  const digest = createHash('sha256')
    .update(`${record.chainKey}\u001f${record.sequence}\u001f${record.hash}`)
    .digest('hex')
    .slice(0, 24);
  return `fr_${digest}`;
}

export class UniversalBridgeService {
  constructor({ fiscalService, store = new MemoryIntegrationStore(), enqueueDelivery = null } = {}) {
    if (!fiscalService) throw new TypeError('fiscalService is required');
    this.fiscalService = fiscalService;
    this.store = store;
    this.enqueueDelivery = enqueueDelivery;
  }

  preflight(input, context) {
    const intent = stampServerIdentity(input, context);
    const validation = validateInvoiceIntent(intent);
    return {
      mode: 'dry-run',
      ok: validation.ok,
      errors: validation.errors,
      warnings: validation.warnings,
      preview: intent,
    };
  }

  preflightMapped(source, profile, context) {
    const mapped = applyMapping(source, profile);
    return this.preflight(mapped, context);
  }

  async issue(input, context, { idempotencyKey } = {}) {
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      throw apiError('VF_API_IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required', 400);
    }
    const intent = stampServerIdentity(input, context);
    assertValid(intent);
    const requestKey = `${context.organizationId}\u001f${context.installationId}\u001f${idempotencyKey}`;
    const reservation = this.store.reserve(requestKey, intent);

    if (reservation.duplicate) {
      if (!reservation.existing.recordId) throw apiError('VF_API_IDEMPOTENCY_IN_PROGRESS', 'The same request is already being processed', 409);
      return { ...this.store.get(reservation.existing.recordId), duplicate: true };
    }

    try {
      const fiscalized = await this.fiscalService.issue(intent);
      const recordId = recordIdFor(fiscalized.record);
      let status = 'fiscalized';
      let delivery = null;

      if (this.enqueueDelivery) {
        delivery = await this.enqueueDelivery({ intent, record: fiscalized.record, recordId });
        status = delivery?.status ?? 'queued';
      }

      const resource = this.store.put({
        recordId,
        organizationId: context.organizationId,
        installationId: context.installationId,
        sourceInvoiceId: intent.sourceInvoiceId,
        status,
        fiscalRecord: fiscalized.record,
        delivery,
      });
      this.store.complete(requestKey, intent, recordId);
      return { ...resource, duplicate: fiscalized.duplicate };
    } catch (error) {
      this.store.release(requestKey, intent);
      throw error;
    }
  }

  async issueMapped(source, profile, context, options) {
    const mapped = applyMapping(source, profile);
    return this.issue(mapped, context, options);
  }

  get(recordId, context) {
    requireContext(context);
    const record = this.store.get(recordId);
    if (!record || record.organizationId !== context.organizationId) {
      throw apiError('VF_API_RECORD_NOT_FOUND', 'Fiscal record not found', 404);
    }
    return record;
  }
}

export { apiError };
