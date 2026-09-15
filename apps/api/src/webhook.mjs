import { createHmac, timingSafeEqual } from 'node:crypto';
import { apiError } from './service.mjs';

function header(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

export function signWebhook({ rawBody, timestamp, secret }) {
  if (!secret) throw new TypeError('secret is required');
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

export function verifyWebhookSignature({ rawBody, headers, secret, now = Date.now(), maxSkewSeconds = 300 }) {
  if (!secret) throw apiError('VF_WEBHOOK_SECRET_UNAVAILABLE', 'Webhook secret is not configured', 500);
  const timestampText = header(headers, 'x-pv-timestamp');
  const signatureHeader = header(headers, 'x-pv-signature');
  if (!timestampText || !signatureHeader) {
    throw apiError('VF_WEBHOOK_SIGNATURE_REQUIRED', 'Webhook signature and timestamp are required', 401);
  }

  const timestamp = Number(timestampText);
  if (!Number.isFinite(timestamp)) throw apiError('VF_WEBHOOK_TIMESTAMP_INVALID', 'Webhook timestamp is invalid', 401);
  const ageSeconds = Math.abs(now - timestamp * 1000) / 1000;
  if (ageSeconds > maxSkewSeconds) throw apiError('VF_WEBHOOK_TIMESTAMP_EXPIRED', 'Webhook timestamp is outside the allowed window', 401);

  const supplied = String(signatureHeader).replace(/^sha256=/i, '').toLowerCase();
  const expected = signWebhook({ rawBody, timestamp: timestampText, secret });
  if (!/^[0-9a-f]{64}$/.test(supplied)) throw apiError('VF_WEBHOOK_SIGNATURE_INVALID', 'Webhook signature is invalid', 401);

  const suppliedBuffer = Buffer.from(supplied, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    throw apiError('VF_WEBHOOK_SIGNATURE_INVALID', 'Webhook signature is invalid', 401);
  }
  return true;
}
