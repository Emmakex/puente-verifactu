import https from 'node:https';
import { AEAT_SOAP_ACTION } from './constants.mjs';

export function createHttpsMtlsTransport({ tls, timeoutMs = 15000 } = {}) {
  if (!tls || (!tls.pfx && !(tls.cert && tls.key))) {
    throw Object.assign(new Error('AEAT mTLS transport requires pfx or cert+key credentials'), { code: 'VF_AEAT_CERTIFICATE_REQUIRED' });
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
        rejectUnauthorized: tls.rejectUnauthorized !== false,
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

export function assertServerSideTls(tls) {
  for (const [key, value] of Object.entries(tls ?? {})) {
    if (typeof value === 'string' && /BEGIN (?:RSA )?PRIVATE KEY/.test(value)) {
      throw Object.assign(new Error(`Private key material must be supplied as Buffer, not serializable string (${key})`), { code: 'VF_AEAT_SECRET_SERIALIZATION_BLOCKED' });
    }
  }
  return tls;
}
