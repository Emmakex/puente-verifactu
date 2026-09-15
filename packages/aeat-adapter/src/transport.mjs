import https from 'node:https';
import { AEAT_SOAP_ACTION } from './constants.mjs';

export function assertServerSideTls(tls) {
  if (!tls || typeof tls !== 'object') return tls;
  if (typeof tls.pfx === 'string') {
    throw Object.assign(new Error('PFX/P12 material must be supplied as Buffer, never as a serializable string'), { code: 'VF_AEAT_SECRET_SERIALIZATION_BLOCKED' });
  }
  if (typeof tls.key === 'string') {
    throw Object.assign(new Error('Private key material must be supplied as Buffer, never as a serializable string'), { code: 'VF_AEAT_SECRET_SERIALIZATION_BLOCKED' });
  }
  if (tls.rejectUnauthorized === false) {
    throw Object.assign(new Error('TLS server certificate verification cannot be disabled for AEAT'), { code: 'VF_AEAT_TLS_VERIFICATION_REQUIRED' });
  }
  return tls;
}

export function createHttpsMtlsTransport({ tls, timeoutMs = 15000 } = {}) {
  assertServerSideTls(tls);
  if (!tls || (!tls.pfx && !(tls.cert && tls.key))) {
    throw Object.assign(new Error('AEAT mTLS transport requires pfx or cert+key credentials'), { code: 'VF_AEAT_CERTIFICATE_REQUIRED' });
  }
  if (tls.pfx && !Buffer.isBuffer(tls.pfx)) {
    throw Object.assign(new Error('PFX/P12 credential must be a Buffer loaded at runtime'), { code: 'VF_AEAT_CERTIFICATE_FORMAT' });
  }
  if (tls.key && !Buffer.isBuffer(tls.key)) {
    throw Object.assign(new Error('Private key must be a Buffer loaded at runtime'), { code: 'VF_AEAT_CERTIFICATE_FORMAT' });
  }

  return async function postXml({ url, body }) {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const request = https.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: AEAT_SOAP_ACTION,
          'Content-Length': Buffer.byteLength(body, 'utf8'),
          'User-Agent': 'Kairoseth-Puente-VeriFactu/1',
        },
        pfx: tls.pfx,
        cert: tls.cert,
        key: tls.key,
        passphrase: tls.passphrase,
        ca: tls.ca,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        timeout: timeoutMs,
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });

      request.on('timeout', () => request.destroy(Object.assign(new Error('AEAT request timed out'), { code: 'VF_AEAT_TIMEOUT' })));
      request.on('error', (error) => reject(Object.assign(error, { code: error.code?.startsWith('VF_') ? error.code : 'VF_AEAT_TRANSPORT_ERROR' })));
      request.end(body, 'utf8');
    });
  };
}
