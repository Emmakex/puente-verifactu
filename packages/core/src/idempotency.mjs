import { createHash } from 'node:crypto';

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function makeIdempotencyKey(intent) {
  const required = [
    intent?.organizationId,
    intent?.installationId,
    intent?.sourceSystem,
    intent?.sourceInvoiceId,
    intent?.operation,
  ];

  if (required.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError('Cannot build idempotency key from incomplete identity');
  }

  return sha256(required.join('\u001f'));
}

export function fingerprintIntent(intent) {
  const { sourceMetadata: _ignored, ...fiscalIntent } = intent ?? {};
  return sha256(stableStringify(fiscalIntent));
}
