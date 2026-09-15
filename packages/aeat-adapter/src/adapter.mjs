import { AEAT_ENDPOINTS } from './constants.mjs';
import { parseAeatSoapResponse } from './response.mjs';
import { serializeAeatSoapRequest } from './serialize.mjs';

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
    let http;
    try {
      http = await this.transport({ url: this.endpoint, body: xml });
    } catch (cause) {
      return {
        kind: 'transport_error',
        status: 'fault',
        retryable: true,
        errorCode: cause.code ?? 'VF_AEAT_TRANSPORT_ERROR',
        message: cause.message,
        waitSeconds: null,
        records: [],
      };
    }

    if (http.statusCode < 200 || http.statusCode >= 300) {
      return {
        kind: 'http_error',
        status: 'fault',
        retryable: http.statusCode >= 500 || http.statusCode === 408 || http.statusCode === 429,
        errorCode: `HTTP_${http.statusCode}`,
        message: `AEAT returned HTTP ${http.statusCode}`,
        waitSeconds: null,
        records: [],
      };
    }

    const normalized = parseAeatSoapResponse(http.body);
    if (normalized.waitSeconds != null) this.nextAllowedAt = this.clock() + normalized.waitSeconds * 1000;
    return normalized;
  }
}
