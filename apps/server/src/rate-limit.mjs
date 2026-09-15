export class FixedWindowRateLimiter {
  constructor({ clock = () => Date.now(), windowMs = 60_000 } = {}) {
    if (!(windowMs > 0)) throw new TypeError('windowMs must be positive');
    this.clock = clock;
    this.windowMs = windowMs;
    this.windows = new Map();
  }

  consume(context) {
    const key = context?.credentialId;
    const limit = context?.rateLimitPerMinute;
    if (!key || !Number.isInteger(limit) || limit < 1) throw new TypeError('credential rate-limit context is invalid');

    const now = this.clock();
    const start = Math.floor(now / this.windowMs) * this.windowMs;
    let state = this.windows.get(key);
    if (!state || state.start !== start) state = { start, count: 0 };
    state.count += 1;
    this.windows.set(key, state);

    const resetAt = start + this.windowMs;
    const allowed = state.count <= limit;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - state.count),
      resetAt,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  cleanup() {
    const now = this.clock();
    for (const [key, state] of this.windows) {
      if (state.start + this.windowMs <= now) this.windows.delete(key);
    }
  }
}
