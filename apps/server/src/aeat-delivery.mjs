function deliveryError(code, message) {
  return Object.assign(new Error(message), { code });
}

function requiredText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw deliveryError('VF_AEAT_DELIVERY_CONTEXT_INVALID', `${field} is required for AEAT delivery`);
  return text;
}

function publicDelivery(job) {
  if (!job) return null;
  const state = String(job.state ?? 'pending');
  return Object.freeze({
    status: state === 'pending' ? 'queued' : state,
    jobId: String(job.id),
    attempts: Number(job.attempts ?? 0),
    retryable: state === 'pending',
    reconciliationRequired: state === 'reconciliation_required',
    reconciliation: job.lastResult?.kind === 'reconciliation_required'
      ? Object.freeze({
          outcome: job.lastResult?.previous?.status ?? null,
          errorCode: job.lastResult?.previous?.errorCode ?? null,
        })
      : null,
  });
}

function aeatEntry({ intent, record }) {
  if (record?.recordType === 'alta') {
    if (!intent || typeof intent !== 'object') {
      throw deliveryError(
        'VF_AEAT_DELIVERY_INTENT_REQUIRED',
        'Alta delivery requires the canonical invoice intent',
      );
    }
    return { intent: structuredClone(intent), record: structuredClone(record) };
  }
  if (record?.recordType === 'anulacion') {
    return { record: structuredClone(record) };
  }
  throw deliveryError(
    'VF_AEAT_DELIVERY_RECORD_INVALID',
    'AEAT delivery requires an alta or anulacion fiscal record',
  );
}

export function createAeatDeliveryQueue({ outbox } = {}) {
  if (!outbox || typeof outbox.enqueue !== 'function' || typeof outbox.get !== 'function') {
    throw new TypeError('AEAT outbox with enqueue() and get() is required');
  }

  return Object.freeze({
    async enqueue({
      intent = null,
      issuer = null,
      record,
      recordId,
    } = {}) {
      const normalizedRecordId = requiredText(recordId, 'recordId');
      const resolvedIssuer = issuer ?? intent?.issuer;
      const issuerIdentity = {
        name: requiredText(resolvedIssuer?.name, 'issuer.name'),
        taxId: requiredText(
          resolvedIssuer?.taxId ?? record?.invoice?.issuerTaxId,
          'issuer.taxId',
        ),
      };
      if (issuerIdentity.taxId !== String(record?.invoice?.issuerTaxId ?? '').trim()) {
        throw deliveryError(
          'VF_AEAT_DELIVERY_ISSUER_MISMATCH',
          'AEAT delivery issuer differs from the fiscal record issuer',
        );
      }

      const id = `aeat_${normalizedRecordId}`;
      const job = await outbox.enqueue({
        issuer: issuerIdentity,
        entries: [aeatEntry({ intent, record })],
      }, { id });
      return publicDelivery(job);
    },

    async resolve(delivery) {
      const jobId = String(delivery?.jobId ?? delivery?.id ?? '').trim();
      if (!jobId) return delivery ?? null;
      const job = await outbox.get(jobId);
      return job ? publicDelivery(job) : delivery;
    },
  });
}

export function createAeatDispatchLoop({
  worker,
  intervalMs = 1000,
  batchSize = 25,
  onError = (error) => {
    console.error(JSON.stringify({
      component: 'aeat-dispatch',
      status: 'error',
      code: error?.code ?? 'VF_AEAT_DISPATCH_ERROR',
      message: error?.message ?? 'AEAT dispatch failed',
    }));
  },
} = {}) {
  if (!worker || typeof worker.runDue !== 'function') {
    throw new TypeError('AEAT outbox worker with runDue() is required');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 250 || intervalMs > 60_000) {
    throw new TypeError('intervalMs must be an integer between 250 and 60000');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new TypeError('batchSize must be an integer between 1 and 100');
  }

  let timer = null;
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await worker.runDue({ limit: batchSize });
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  };

  return Object.freeze({
    async start() {
      if (timer || stopped) return;
      await tick();
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      timer.unref?.();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      while (running) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  });
}
