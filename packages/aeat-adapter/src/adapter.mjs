import { AEAT_ENDPOINTS } from './constants.mjs';
import { parseAeatQueryResponse, serializeAeatQueryRequest } from './query.mjs';
import { parseAeatSoapResponse } from './response.mjs';
import { serializeAeatSoapRequest } from './serialize.mjs';

function transportError(cause, operation) {
  return {
    kind: 'transport_error',
    operation,
    status: 'fault',
    retryable: true,
    errorCode: cause.code ?? 'VF_AEAT_TRANSPORT_ERROR',
    message: cause.message,
    waitSeconds: null,
    records: [],
  };
}

function httpError(statusCode, operation) {
  return {
    kind: 'http_error',
    operation,
    status: 'fault',
    retryable: statusCode >= 500 || statusCode === 408 || statusCode === 429,
    errorCode: `HTTP_${statusCode}`,
    message: `AEAT returned HTTP ${statusCode}`,
    waitSeconds: null,
    records: [],
  };
}

export class AeatVerifactuAdapter {
  constructor({ sif, transport, environment = 'test', useSealEndpoint = false, allowProduction = false, clock = () => Date.now() }) {
    if (!sif) throw new TypeError('sif configuration is required');
    if (typeof transport !== 'function') throw new TypeError('transport function is required');
    if (environment === 'production' && !allowProduction) {
      throw Object.assign(new Error('Production AEAT endpoint requires explicit allowProduction=true'), { code: 'VF_AEAT_PRODUCTION_GUARD' });
    }
    this.sif = sif;
    this.transport = transport;
    this.environment = environment;
    this.useSealEndpoint = useSealEndpoint;
    this.clock = clock;
    this.nextAllowedAt = 0;
  }

  get endpoint() {
    if (this.environment === 'production') return this.useSealEndpoint ? AEAT_ENDPOINTS.productionSeal : AEAT_ENDPOINTS.production;
    return this.useSealEndpoint ? AEAT_ENDPOINTS.testSeal : AEAT_ENDPOINTS.test;
  }

  async postXml(xml, operation) {
    let http;
    try {
      http = await this.transport({ url: this.endpoint, body: xml });
    } catch (cause) {
      return { error: transportError(cause, operation) };
    }
    if (http.statusCode < 200 || http.statusCode >= 300) {
      return { error: httpError(http.statusCode, operation) };
    }
    return { http };
  }

  async submit(request) {
    const now = this.clock();
    if (now < this.nextAllowedAt) {
      const error = new Error('AEAT control-flow wait window is still active');
      error.code = 'VF_AEAT_THROTTLED';
      error.retryAt = this.nextAllowedAt;
      error.retryAfterMs = this.nextAllowedAt - now;
      throw error;
    }

    const xml = serializeAeatSoapRequest({ ...request, sif: this.sif });
    const posted = await this.postXml(xml, 'submit');
    if (posted.error) return posted.error;
    const normalized = parseAeatSoapResponse(posted.http.body);
    if (normalized.waitSeconds != null) this.nextAllowedAt = this.clock() + normalized.waitSeconds * 1000;
    return normalized;
  }

  async queryPresentedRecords(request) {
    const xml = serializeAeatQueryRequest(request);
    const posted = await this.postXml(xml, 'query');
    if (posted.error) return posted.error;
    return parseAeatQueryResponse(posted.http.body);
  }
}
