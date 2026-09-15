export class PuenteVerifactuError extends Error {
  constructor(message, { status, code, retryable = false, correlationId, details = [] } = {}) {
    super(message);
    this.name = 'PuenteVerifactuError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.correlationId = correlationId;
    this.details = details;
  }
}

function cleanBaseUrl(value) {
  const url = new URL(value);
  return url.toString().replace(/\/$/, '');
}

export class PuenteVerifactuClient {
  constructor({ baseUrl, apiKey, fetchImpl = globalThis.fetch, connectorVersion = 'unknown' } = {}) {
    if (!baseUrl) throw new TypeError('baseUrl is required');
    if (!apiKey) throw new TypeError('apiKey is required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
    this.baseUrl = cleanBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.connectorVersion = connectorVersion;
  }

  async request(path, { method = 'GET', body, idempotencyKey } = {}) {
    const headers = {
      accept: 'application/json',
      authorization: `Bearer ${this.apiKey}`,
      'x-connector-version': this.connectorVersion,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new PuenteVerifactuError('Puente VeriFactu returned a non-JSON response', {
        status: response.status,
        code: 'VF_SDK_INVALID_RESPONSE',
        retryable: response.status >= 500,
        correlationId: response.headers?.get?.('x-correlation-id') ?? undefined,
      });
    }

    if (!response.ok) {
      const error = payload?.error ?? {};
      throw new PuenteVerifactuError(error.message ?? 'Puente VeriFactu request failed', {
        status: response.status,
        code: error.code ?? 'VF_SDK_REQUEST_FAILED',
        retryable: Boolean(error.retryable),
        correlationId: error.correlationId ?? response.headers?.get?.('x-correlation-id') ?? undefined,
        details: error.details ?? [],
      });
    }
    return payload;
  }

  preflight(intent) {
    return this.request('/v1/preflight', { method: 'POST', body: { intent } });
  }

  preflightMapped(profileId, source) {
    return this.request('/v1/preflight', { method: 'POST', body: { profileId, source } });
  }

  issue(intent, { idempotencyKey } = {}) {
    return this.request('/v1/fiscal-records', { method: 'POST', body: { intent }, idempotencyKey });
  }

  issueMapped(profileId, source, { idempotencyKey } = {}) {
    return this.request('/v1/fiscal-records', { method: 'POST', body: { profileId, source }, idempotencyKey });
  }

  getFiscalRecord(recordId) {
    return this.request(`/v1/fiscal-records/${encodeURIComponent(recordId)}`);
  }
}
