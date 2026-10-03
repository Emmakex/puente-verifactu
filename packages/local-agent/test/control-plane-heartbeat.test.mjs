import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateLocalAgentConfig } from '../src/config.mjs';
import { createLocalAgentRuntime } from '../src/runtime.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('Local Agent heartbeats are outbound, throttled and never auto-apply desired versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pv-local-agent-heartbeat-'));
  let now = 1_000_000;
  const config = validateLocalAgentConfig({
    schemaVersion: 1,
    installationId: 'agent-heartbeat',
    dataDir: './data',
    bridge: {
      baseUrl: 'https://bridge.example',
      apiKeyEnv: 'PV_LOCAL_AGENT_API_KEY',
    },
    runtime: {
      pollIntervalMs: 5_000,
      heartbeatIntervalMs: 60_000,
      workerBatchSize: 10,
    },
    source: {
      kind: 'watch-folder',
      sourceId: 'watch',
      profileId: 'profile',
      root: './files',
      issueEnabled: true,
      minAgeMs: 0,
    },
  }, { baseDir: root });
  await mkdir(join(config.source.root, 'inbox'), { recursive: true });

  const calls = [];
  const runtime = createLocalAgentRuntime({
    config,
    env: { PV_LOCAL_AGENT_API_KEY: 'agent-token' },
    now: () => now,
    fetchImpl: async (url, options = {}) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, method: options.method ?? 'GET', body: options.body ?? null });
      if (path === '/v1/local-agent/heartbeat') {
        return jsonResponse(200, {
          schemaVersion: 1,
          accepted: true,
          control: {
            desiredVersion: '0.2.0',
            updatePolicy: 'manual',
            updateAvailable: true,
            autoUpdate: false,
          },
        });
      }
      throw new Error(`unexpected request: ${path}`);
    },
  });

  try {
    const first = await runtime.runOnce();
    assert.equal(first.heartbeat.ok, true);
    assert.equal(first.heartbeat.control.desiredVersion, '0.2.0');
    assert.equal(first.heartbeat.control.autoUpdate, false);
    assert.equal(calls.filter((call) => call.path === '/v1/local-agent/heartbeat').length, 1);

    const sent = JSON.parse(calls.find((call) => call.path === '/v1/local-agent/heartbeat').body);
    assert.equal(sent.platform, process.platform);
    assert.equal(sent.arch, process.arch);
    assert.equal(sent.sourceKind, 'watch-folder');
    assert.equal('organizationId' in sent, false);
    assert.equal('installationId' in sent, false);
    assert.equal('source' in sent, false);
    assert.deepEqual(Object.keys(sent.queue).sort(), [
      'blocked', 'completed', 'due', 'expired', 'pending', 'processing', 'total',
    ]);

    now += 5_000;
    const second = await runtime.runOnce();
    assert.equal(second.heartbeat.skipped, true);
    assert.equal(calls.filter((call) => call.path === '/v1/local-agent/heartbeat').length, 1);

    now += 60_000;
    const third = await runtime.runOnce();
    assert.equal(third.heartbeat.ok, true);
    assert.equal(calls.filter((call) => call.path === '/v1/local-agent/heartbeat').length, 2);
    assert.equal(runtime.status().control.autoUpdate, false);
  } finally {
    await runtime.close();
  }
});
