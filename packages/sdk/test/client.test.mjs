import test from 'node:test';
import assert from 'node:assert/strict';
import { PuenteVerifactuClient, PuenteVerifactuError } from '../src/client.mjs';

function fakeResponse(status, payload, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  };
}

test('SDK sends auth, connector version and idempotency key', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return fakeResponse(202, { recordId: 'fr_demo', status: 'fiscalized' });
  };
  const client = new PuenteVerifactuClient({
    baseUrl: 'https://bridge.example.test/',
    apiKey: 'test-key',
    connectorVersion: 'erp-demo/1.0.0',
    fetchImpl,
  });
  const result = await client.issue({ sourceInvoiceId: 'inv-1' }, { idempotencyKey: 'event-1' });
  assert.equal(result.recordId, 'fr_demo');
  assert.equal(captured.url, 'https://bridge.example.test/v1/fiscal-records');
  assert.equal(captured.options.headers.authorization, 'Bearer test-key');
  assert.equal(captured.options.headers['x-connector-version'], 'erp-demo/1.0.0');
  assert.equal(captured.options.headers['idempotency-key'], 'event-1');
});

test('SDK normalizes API errors', async () => {
  const fetchImpl = async () => fakeResponse(422, {
    error: {
      code: 'VF_API_VALIDATION_FAILED',
      message: 'InvoiceIntent validation failed',
      retryable: false,
      correlationId: 'corr-1',
      details: [{ code: 'VF_VALIDATION_REQUIRED' }],
    },
  });
  const client = new PuenteVerifactuClient({ baseUrl: 'https://bridge.example.test', apiKey: 'test-key', fetchImpl });
  await assert.rejects(
    () => client.issue({}, { idempotencyKey: 'event-1' }),
    (error) => error instanceof PuenteVerifactuError
      && error.code === 'VF_API_VALIDATION_FAILED'
      && error.status === 422
      && error.correlationId === 'corr-1'
      && error.details.length === 1,
  );
});
