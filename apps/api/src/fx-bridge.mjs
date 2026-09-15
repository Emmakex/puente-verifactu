import { createHash } from 'node:crypto';
import { applyMapping } from '../../../packages/core/src/mapping.mjs';
import { stableStringify } from '../../../packages/core/src/idempotency.mjs';
import { convertInvoiceIntentToEuro } from '../../../packages/core/src/euro-conversion.mjs';
import { validateInvoiceIntent } from '../../../packages/core/src/validation.mjs';
import { UniversalBridgeService, apiError, stampServerIdentity } from './service.mjs';

function recordIdFor(record) {
  const digest = createHash('sha256')
    .update(`${record.chainKey}\u001f${record.sequence}\u001f${record.hash}`)
    .digest('hex')
    .slice(0, 24);
  return `fr_${digest}`;
}

function fxIssue(code, message) {
  return {
    code,
    path: 'currency',
    severity: 'error',
    message: {
      es: message,
      en: message,
    },
  };
}

function asApiFxError(error) {
  if (error?.status) return error;
  if (String(error?.code ?? '').startsWith('VF_FX_')) {
    error.status = 422;
    if (!Array.isArray(error.details) || error.details.length === 0) error.details = [fxIssue(error.code, error.message)];
  }
  return error;
}

export class FxAwareBridgeService extends UniversalBridgeService {
  constructor({ resolveEuroConversion = null, ...options } = {}) {
    super(options);
    if (resolveEuroConversion !== null && typeof resolveEuroConversion !== 'function') {
      throw new TypeError('resolveEuroConversion must be a function when configured');
    }
    this.resolveEuroConversion = resolveEuroConversion;
  }

  prepare(input, context) {
    const sourceIntent = stampServerIdentity(input, context);
    if (sourceIntent.currency === 'EUR') {
      const validation = validateInvoiceIntent(sourceIntent);
      if (!validation.ok) throw apiError('VF_API_VALIDATION_FAILED', 'InvoiceIntent validation failed', 422, validation.errors);
      return { sourceIntent, fiscalIntent: sourceIntent, conversion: null };
    }

    if (!this.resolveEuroConversion) {
      throw apiError(
        'VF_API_EUR_CONVERSION_REQUIRED',
        'Non-EUR invoice requires a server-side EUR conversion configuration',
        422,
        [fxIssue('VF_VALIDATION_NON_EUR_CONVERSION_REQUIRED', 'La factura en divisa necesita una conversión fiscal a EUR configurada en el servidor.')],
      );
    }

    const conversion = this.resolveEuroConversion({ context, intent: sourceIntent });
    if (conversion && typeof conversion.then === 'function') {
      throw apiError('VF_API_EUR_CONVERSION_ASYNC_UNSUPPORTED', 'EUR conversion resolver must be synchronous in runtime v1', 500);
    }
    if (!conversion) {
      throw apiError(
        'VF_API_EUR_CONVERSION_NOT_FOUND',
        `No EUR conversion is configured for ${sourceIntent.currency} on ${sourceIntent.issueDate}`,
        422,
        [fxIssue('VF_VALIDATION_NON_EUR_CONVERSION_REQUIRED', 'No existe un tipo de cambio fiscal EUR configurado para esta moneda y fecha.')],
      );
    }

    try {
      const converted = convertInvoiceIntentToEuro(sourceIntent, conversion);
      return { sourceIntent, ...converted };
    } catch (error) {
      throw asApiFxError(error);
    }
  }

  preflight(input, context) {
    try {
      const prepared = this.prepare(input, context);
      return {
        mode: 'dry-run',
        ok: true,
        errors: [],
        warnings: [],
        preview: prepared.fiscalIntent,
        sourcePreview: prepared.sourceIntent,
        currencyConversion: prepared.conversion,
      };
    } catch (error) {
      const normalized = asApiFxError(error);
      if (normalized?.status !== 422) throw normalized;
      return {
        mode: 'dry-run',
        ok: false,
        errors: Array.isArray(normalized.details) && normalized.details.length > 0
          ? normalized.details
          : [fxIssue(normalized.code ?? 'VF_API_VALIDATION_FAILED', normalized.message)],
        warnings: [],
        preview: stampServerIdentity(input, context),
        sourcePreview: stampServerIdentity(input, context),
        currencyConversion: null,
      };
    }
  }

  preflightMapped(source, profile, context) {
    return this.preflight(applyMapping(source, profile), context);
  }

  async issue(input, context, { idempotencyKey } = {}) {
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      throw apiError('VF_API_IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required', 400);
    }

    const prepared = this.prepare(input, context);
    const requestPayload = {
      sourceIntent: prepared.sourceIntent,
      fiscalIntent: prepared.fiscalIntent,
      currencyConversion: prepared.conversion,
    };
    const requestKey = `${context.organizationId}\u001f${context.installationId}\u001f${idempotencyKey}`;
    const reservation = this.store.reserve(requestKey, requestPayload);

    if (reservation.duplicate) {
      if (!reservation.existing.recordId) throw apiError('VF_API_IDEMPOTENCY_IN_PROGRESS', 'The same request is already being processed', 409);
      return { ...this.store.get(reservation.existing.recordId), duplicate: true };
    }

    try {
      const fiscalized = await this.fiscalService.issue(prepared.fiscalIntent);
      const recordId = recordIdFor(fiscalized.record);
      let status = 'fiscalized';
      let delivery = null;

      if (this.enqueueDelivery) {
        delivery = await this.enqueueDelivery({
          intent: prepared.fiscalIntent,
          sourceIntent: prepared.sourceIntent,
          currencyConversion: prepared.conversion,
          record: fiscalized.record,
          recordId,
        });
        status = delivery?.status ?? 'queued';
      }

      const resource = this.store.put({
        recordId,
        organizationId: context.organizationId,
        installationId: context.installationId,
        sourceInvoiceId: prepared.sourceIntent.sourceInvoiceId,
        sourceCurrency: prepared.sourceIntent.currency,
        fiscalCurrency: 'EUR',
        currencyConversion: prepared.conversion,
        status,
        fiscalRecord: fiscalized.record,
        delivery,
      });
      this.store.complete(requestKey, requestPayload, recordId);
      return { ...resource, duplicate: fiscalized.duplicate };
    } catch (error) {
      this.store.release(requestKey, requestPayload);
      throw error;
    }
  }

  async issueMapped(source, profile, context, options) {
    return this.issue(applyMapping(source, profile), context, options);
  }
}

export function euroConversionFingerprint(conversion) {
  return createHash('sha256').update(stableStringify(conversion ?? null)).digest('hex');
}
