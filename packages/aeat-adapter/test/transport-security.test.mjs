import test from 'node:test';
import assert from 'node:assert/strict';
import { assertServerSideTls, createHttpsMtlsTransport } from '../src/transport.mjs';

test('PFX material cannot be supplied as a serializable string', () => {
  assert.throws(() => assertServerSideTls({ pfx: 'base64-or-path-string' }), { code: 'VF_AEAT_SECRET_SERIALIZATION_BLOCKED' });
});

test('private key cannot be supplied as a string', () => {
  assert.throws(() => assertServerSideTls({ cert: 'public certificate', key: '-----BEGIN PRIVATE KEY-----secret' }), { code: 'VF_AEAT_SECRET_SERIALIZATION_BLOCKED' });
});

test('TLS server verification cannot be disabled', () => {
  assert.throws(() => assertServerSideTls({ pfx: Buffer.from('test'), rejectUnauthorized: false }), { code: 'VF_AEAT_TLS_VERIFICATION_REQUIRED' });
});

test('mTLS transport requires credentials', () => {
  assert.throws(() => createHttpsMtlsTransport({ tls: {} }), { code: 'VF_AEAT_CERTIFICATE_REQUIRED' });
});

test('PFX credential is accepted only as runtime Buffer', () => {
  const transport = createHttpsMtlsTransport({ tls: { pfx: Buffer.from('not-a-real-pfx') } });
  assert.equal(typeof transport, 'function');
});
