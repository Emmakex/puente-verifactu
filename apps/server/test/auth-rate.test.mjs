import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpAuthenticator, hashBasicPassword, hashBearerToken } from '../src/auth.mjs';
import { FixedWindowRateLimiter } from '../src/rate-limit.mjs';

const bearerToken = 'contract-test-bearer-secret';
const salt = '00'.repeat(16);
const password = 'test-basic-password';
const config = {
  credentials: [
    {
      id: 'api-test',
      type: 'bearer',
      tokenSha256: hashBearerToken(bearerToken),
      organizationId: 'org-api',
      installationId: 'install-api',
      sourceSystem: 'erp-test',
      rateLimitPerMinute: 2,
    },
    {
      id: 'ui-test',
      type: 'basic',
      username: 'demo',
      passwordSalt: salt,
      passwordScrypt: hashBasicPassword(password, salt),
      organizationId: 'org-ui',
      installationId: 'install-ui',
      sourceSystem: 'file-upload',
      rateLimitPerMinute: 10,
    },
  ],
};

test('bearer and basic credentials resolve server-authoritative context', () => {
  const authenticate = createHttpAuthenticator(config);
  const bearer = authenticate({ headers: { authorization: `Bearer ${bearerToken}` } });
  assert.equal(bearer.organizationId, 'org-api');
  assert.equal(bearer.installationId, 'install-api');
  assert.equal(bearer.sourceSystem, 'erp-test');

  const encoded = Buffer.from(`demo:${password}`).toString('base64');
  const basic = authenticate({ headers: { authorization: `Basic ${encoded}` } });
  assert.equal(basic.organizationId, 'org-ui');
  assert.equal(basic.authType, 'basic');
});

test('invalid or absent credentials are rejected without context', () => {
  const authenticate = createHttpAuthenticator(config);
  assert.throws(() => authenticate({ headers: {} }), { code: 'VF_AUTH_REQUIRED' });
  assert.throws(() => authenticate({ headers: { authorization: 'Bearer wrong' } }), { code: 'VF_AUTH_INVALID_BEARER' });
  const wrongBasic = Buffer.from('demo:wrong').toString('base64');
  assert.throws(() => authenticate({ headers: { authorization: `Basic ${wrongBasic}` } }), { code: 'VF_AUTH_INVALID_BASIC' });
});

test('fixed-window limiter isolates counters by credential', () => {
  let now = 10_000;
  const limiter = new FixedWindowRateLimiter({ clock: () => now, windowMs: 60_000 });
  const api = { credentialId: 'api', rateLimitPerMinute: 2 };
  const ui = { credentialId: 'ui', rateLimitPerMinute: 1 };
  assert.equal(limiter.consume(api).allowed, true);
  assert.equal(limiter.consume(api).allowed, true);
  const limited = limiter.consume(api);
  assert.equal(limited.allowed, false);
  assert.ok(limited.retryAfterSeconds > 0);
  assert.equal(limiter.consume(ui).allowed, true);
  now = 70_000;
  assert.equal(limiter.consume(api).allowed, true);
});
