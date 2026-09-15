const DECIMAL_RE = /^-?\d+(?:\.\d{1,2})?$/;

export function isAmount(value) {
  return typeof value === 'string' && DECIMAL_RE.test(value);
}

export function toCents(value) {
  if (!isAmount(value)) {
    throw new TypeError(`Invalid monetary amount: ${String(value)}`);
  }

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}

export function fromCents(value) {
  if (typeof value !== 'bigint') {
    throw new TypeError('fromCents expects bigint');
  }

  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  const whole = unsigned / 100n;
  const cents = String(unsigned % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${cents}`;
}

export function sumAmounts(values) {
  return fromCents(values.reduce((sum, value) => sum + toCents(value), 0n));
}
