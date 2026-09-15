import test from 'node:test';
import assert from 'node:assert/strict';
import { hashBearerToken, validateAuthConfig } from '../src/auth.mjs';
import { createPuenteRuntime } from '../src/runtime.mjs';

const integrationToken = 'integration-token';
const opsToken = 'ops-token';

function authConfig() {
  return {
    credentials: [
      {
        id: 'integration',
        type: 'bearer',
        tokenSha256: hashBearerToken(integrationToken),
        organizationId: 'org-runtime',
        installationId: 'erp',
        sourceSystem: 'erp',
        rateLimitPerMinute: 60,
      },
      {
        id: 'operator',
        type: 'bearer',
        tokenSha256: hashBearerToken(opsToken),
        organizationId: 'ops',
        installationId: 'runtime',
        sourceSystem: 'operations',
        rateLimitPerMinute: 60,
        permissions: ['ops:read'],
      },
    ],
  };
}

async function listen(runtime) {
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(0, '127.0.0.1', () => {
      runtime.server.off('error', reject);
      resolve();
    });
  });
  const address = runtime.server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('operational status requires explicit ops:read permission and exposes only aggregate data', async () => {
  const now = Date.parse('2026-09-15T18:00:00Z');
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    observabilityClock: () => now,
  });
  try {
    runtime.persistence.aeatOutbox.enqueue({ invoiceTaxId: 'B12345678', secret: 'DO-NOT-LEAK' }, {
      id: 'private-job-id',
      availableAt: now - 10 * 60 * 1000,
      now: now - 10 * 60 * 1000,
    });
    const baseUrl = await listen(runtime);

    const unauthenticated = await fetch(`${baseUrl}/v1/ops/status`);
    assert.equal(unauthenticated.status, 401);

    const forbidden = await fetch(`${baseUrl}/v1/ops/status`, {
      headers: { authorization: `Bearer ${integrationToken}` },
    });
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).error.code, 'VF_OPS_FORBIDDEN');

    const allowed = await fetch(`${baseUrl}/v1/ops/status`, {
      headers: { authorization: `Bearer ${opsToken}` },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('cache-control'), 'no-store');
    const body = await allowed.json();
    assert.equal(body.schemaVersion, 1);
    assert.equal(body.aeatOutbox.pending, 1);
    assert.equal(body.aeatOutbox.oldestPendingAgeMs, 10 * 60 * 1000);
    assert.equal(body.backup.status, 'unconfigured');
    assert.equal(body.summary.status, 'warning');
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /B12345678|DO-NOT-LEAK|private-job-id|org-runtime|integration-token|ops-token/);

    const methodDenied = await fetch(`${baseUrl}/v1/ops/status`, {
      method: 'POST',
      headers: { authorization: `Bearer ${opsToken}` },
    });
    assert.equal(methodDenied.status, 405);
    assert.equal(methodDenied.headers.get('allow'), 'GET');
  } finally {
    await runtime.close();
  }
});

test('auth config rejects unknown operational permissions without opening runtime resources', () => {
  assert.throws(() => validateAuthConfig({
    credentials: [{
      id: 'bad',
      type: 'bearer',
      tokenSha256: hashBearerToken('bad-token'),
      organizationId: 'ops',
      installationId: 'runtime',
      sourceSystem: 'ops',
      rateLimitPerMinute: 60,
      permissions: ['ops:write'],
    }],
  }), /unsupported permission/);
});
