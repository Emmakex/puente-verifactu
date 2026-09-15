import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadPfxCredentials,
  resolvePfxPassphrase,
  validatePfxBuffer,
} from '../certificate-preflight-lib.mjs';

test('PFX passphrase sources are mutually exclusive', async () => {
  await assert.rejects(
    resolvePfxPassphrase({
      AEAT_TEST_PFX_PASSPHRASE: 'direct-secret',
      AEAT_TEST_PFX_PASSPHRASE_FILE: '/run/secrets/pfx-passphrase',
    }),
    { code: 'VF_AEAT_GATE_PFX_PASSPHRASE_AMBIGUOUS' },
  );
});

test('PFX passphrase can be read from a secret file without retaining newline', async () => {
  const resolved = await resolvePfxPassphrase(
    { AEAT_TEST_PFX_PASSPHRASE_FILE: '/run/secrets/pfx-passphrase' },
    { readText: async () => 'secret-value\n' },
  );
  assert.deepEqual(resolved, { passphrase: 'secret-value', source: 'file' });
});

test('PFX validation invokes TLS secure-context parsing and returns only fingerprint metadata', () => {
  const pfx = Buffer.from('synthetic-pfx-bytes');
  let received = null;
  const summary = validatePfxBuffer(pfx, 'private-passphrase', {
    createSecureContextFn: (options) => {
      received = options;
      return {};
    },
  });

  assert.equal(received.pfx, pfx);
  assert.equal(received.passphrase, 'private-passphrase');
  assert.equal(summary.bytes, pfx.length);
  assert.match(summary.sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(summary), /private-passphrase/);
});

test('invalid PFX or wrong passphrase is normalized without leaking parser details', () => {
  assert.throws(
    () => validatePfxBuffer(Buffer.from('bad-pfx'), 'wrong', {
      createSecureContextFn: () => {
        throw new Error('openssl internal error with sensitive parser details');
      },
    }),
    (error) => {
      assert.equal(error.code, 'VF_AEAT_GATE_PFX_INVALID');
      assert.doesNotMatch(error.message, /openssl|sensitive parser/i);
      return true;
    },
  );
});

test('offline preflight requires a configured PFX path', async () => {
  await assert.rejects(
    loadPfxCredentials({}, {
      readBinary: async () => Buffer.from('unused'),
      createSecureContextFn: () => ({}),
    }),
    { code: 'VF_AEAT_GATE_PFX_PATH_REQUIRED' },
  );
});

test('offline preflight returns sanitized metadata and never opens network', async () => {
  const pfx = Buffer.from('synthetic-pfx-content');
  const credentials = await loadPfxCredentials({
    AEAT_TEST_PFX_PATH: '/private/location/company.pfx',
    AEAT_TEST_PFX_PASSPHRASE: 'top-secret',
  }, {
    readBinary: async (path) => {
      assert.equal(path, '/private/location/company.pfx');
      return pfx;
    },
    createSecureContextFn: ({ pfx: receivedPfx, passphrase }) => {
      assert.equal(receivedPfx, pfx);
      assert.equal(passphrase, 'top-secret');
      return {};
    },
  });

  assert.equal(credentials.summary.status, 'ok');
  assert.equal(credentials.summary.networkUsed, false);
  assert.equal(credentials.summary.passphraseSource, 'environment');
  assert.equal(credentials.summary.scope, 'container-and-passphrase-only');
  const publicText = JSON.stringify(credentials.summary);
  assert.doesNotMatch(publicText, /top-secret/);
  assert.doesNotMatch(publicText, /private\/location/);
});

test('unreadable PFX path is normalized without exposing filesystem details', async () => {
  await assert.rejects(
    loadPfxCredentials({ AEAT_TEST_PFX_PATH: '/private/location/company.pfx' }, {
      readBinary: async () => {
        throw new Error('ENOENT /private/location/company.pfx');
      },
    }),
    (error) => {
      assert.equal(error.code, 'VF_AEAT_GATE_PFX_UNREADABLE');
      assert.doesNotMatch(error.message, /private\/location|ENOENT/);
      return true;
    },
  );
});
