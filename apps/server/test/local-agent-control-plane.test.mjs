import test from 'node:test';
import assert from 'node:assert/strict';
import { hashBearerToken } from '../src/auth.mjs';
import { createPuenteRuntime } from '../src/runtime.mjs';

const manageToken = 'kairoseth-control-plane-test-secret';

function authConfig() {
  return {
    credentials: [{
      id: 'kairoseth-agents-manager',
      type: 'bearer',
      tokenSha256: hashBearerToken(manageToken),
      organizationId: 'kairoseth-control',
      installationId: 'control-plane',
      sourceSystem: 'kairoseth',
      rateLimitPerMinute: 1000,
      permissions: ['agents:manage'],
    }],
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

async function jsonRequest(baseUrl, path, {
  method = 'GET',
  token = manageToken,
  body,
} = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test('Kairoseth control plane provisions, observes, rotates and revokes Local Agent credentials', async () => {
  let now = Date.UTC(2026, 9, 3, 19, 0, 0);
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    observabilityClock: () => now,
  });

  try {
    const baseUrl = await listen(runtime);

    const provision = await jsonRequest(baseUrl, '/v1/control-plane/local-agents', {
      method: 'POST',
      body: {
        organizationId: 'org-001',
        installationId: 'erp-local-01',
        sourceSystem: 'erp-acme',
        label: 'ERP principal',
        updatePolicy: 'manual',
      },
    });
    assert.equal(provision.response.status, 201);
    assert.equal(provision.body.installation.organizationId, 'org-001');
    assert.equal(provision.body.installation.installationId, 'erp-local-01');
    assert.equal(provision.body.installation.online, false);
    assert.match(provision.body.credential.token, /^pvla_[A-Za-z0-9_-]+$/);
    assert.equal(provision.body.credential.shownOnce, true);
    const firstToken = provision.body.credential.token;

    const listBefore = await jsonRequest(baseUrl, '/v1/control-plane/local-agents');
    assert.equal(listBefore.response.status, 200);
    assert.equal(listBefore.body.installations.length, 1);
    assert.equal('tokenSha256' in listBefore.body.installations[0], false);
    assert.equal('credential' in listBefore.body.installations[0], false);

    const heartbeat = await jsonRequest(baseUrl, '/v1/local-agent/heartbeat', {
      method: 'POST',
      token: firstToken,
      body: {
        agentVersion: '0.1.0',
        platform: 'linux',
        arch: 'x64',
        sourceKind: 'database',
        status: 'ok',
        queue: {
          total: 3,
          pending: 1,
          processing: 0,
          completed: 2,
          blocked: 0,
          due: 1,
          expired: 0,
        },
      },
    });
    assert.equal(heartbeat.response.status, 200);
    assert.equal(heartbeat.body.accepted, true);
    assert.equal(heartbeat.body.installation.online, true);
    assert.equal(heartbeat.body.installation.organizationId, 'org-001');
    assert.equal(heartbeat.body.installation.queue.pending, 1);
    assert.equal(heartbeat.body.control.autoUpdate, false);

    const spoof = await jsonRequest(baseUrl, '/v1/local-agent/heartbeat', {
      method: 'POST',
      token: firstToken,
      body: {
        organizationId: 'other-org',
        agentVersion: '0.1.0',
        platform: 'linux',
        arch: 'x64',
        sourceKind: 'database',
        queue: {},
      },
    });
    assert.equal(spoof.response.status, 400);
    assert.equal(spoof.body.error.code, 'VF_LOCAL_AGENT_HEARTBEAT_IDENTITY_FORBIDDEN');

    const control = await jsonRequest(baseUrl, '/v1/control-plane/local-agents', {
      method: 'PATCH',
      body: {
        organizationId: 'org-001',
        installationId: 'erp-local-01',
        desiredVersion: '0.2.0',
        updatePolicy: 'manual',
      },
    });
    assert.equal(control.response.status, 200);
    assert.equal(control.body.desiredVersion, '0.2.0');
    assert.equal(control.body.updateAvailable, true);

    now += 1_000;
    const heartbeatAfterControl = await jsonRequest(baseUrl, '/v1/local-agent/heartbeat', {
      method: 'POST',
      token: firstToken,
      body: {
        agentVersion: '0.1.0',
        platform: 'linux',
        arch: 'x64',
        sourceKind: 'database',
        queue: {},
      },
    });
    assert.equal(heartbeatAfterControl.body.control.desiredVersion, '0.2.0');
    assert.equal(heartbeatAfterControl.body.control.updateAvailable, true);
    assert.equal(heartbeatAfterControl.body.control.autoUpdate, false);

    const rotate = await jsonRequest(baseUrl, '/v1/control-plane/local-agents/rotate-credential', {
      method: 'POST',
      body: {
        organizationId: 'org-001',
        installationId: 'erp-local-01',
      },
    });
    assert.equal(rotate.response.status, 200);
    const secondToken = rotate.body.credential.token;
    assert.notEqual(secondToken, firstToken);
    assert.equal(rotate.body.installation.credentialVersion, 2);

    const oldCredential = await jsonRequest(baseUrl, '/v1/local-agent/heartbeat', {
      method: 'POST',
      token: firstToken,
      body: {
        agentVersion: '0.1.0',
        platform: 'linux',
        arch: 'x64',
        sourceKind: 'database',
        queue: {},
      },
    });
    assert.equal(oldCredential.response.status, 401);

    const newCredential = await jsonRequest(baseUrl, '/v1/local-agent/heartbeat', {
      method: 'POST',
      token: secondToken,
      body: {
        agentVersion: '0.1.0',
        platform: 'linux',
        arch: 'x64',
        sourceKind: 'database',
        queue: {},
      },
    });
    assert.equal(newCredential.response.status, 200);

    const revoke = await jsonRequest(baseUrl, '/v1/control-plane/local-agents/revoke', {
      method: 'POST',
      body: {
        organizationId: 'org-001',
        installationId: 'erp-local-01',
      },
    });
    assert.equal(revoke.response.status, 200);
    assert.equal(revoke.body.revoked, true);
    assert.equal(revoke.body.status, 'revoked');

    const revokedCredential = await jsonRequest(baseUrl, '/v1/local-agent/heartbeat', {
      method: 'POST',
      token: secondToken,
      body: {
        agentVersion: '0.1.0',
        platform: 'linux',
        arch: 'x64',
        sourceKind: 'database',
        queue: {},
      },
    });
    assert.equal(revokedCredential.response.status, 401);
  } finally {
    await runtime.close();
  }
});

test('Local Agent registry derives offline state from Kairoseth server time', async () => {
  let now = 1_000_000;
  const runtime = createPuenteRuntime({
    databasePath: ':memory:',
    authConfig: authConfig(),
    sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    observabilityClock: () => now,
  });

  try {
    const baseUrl = await listen(runtime);
    const provision = await jsonRequest(baseUrl, '/v1/control-plane/local-agents', {
      method: 'POST',
      body: {
        organizationId: 'org-002',
        installationId: 'agent-02',
        sourceSystem: 'legacy-erp',
      },
    });
    const token = provision.body.credential.token;

    await jsonRequest(baseUrl, '/v1/local-agent/heartbeat', {
      method: 'POST',
      token,
      body: {
        agentVersion: '0.1.0',
        platform: 'win32',
        arch: 'x64',
        sourceKind: 'watch-folder',
        queue: {},
      },
    });

    now += 180_001;
    const list = await jsonRequest(baseUrl, '/v1/control-plane/local-agents');
    assert.equal(list.body.installations[0].online, false);
    assert.equal(list.body.installations[0].status, 'offline');
  } finally {
    await runtime.close();
  }
});
