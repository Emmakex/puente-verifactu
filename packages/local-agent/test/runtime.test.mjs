import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateLocalAgentConfig } from '../src/config.mjs';
import {
  acquireLocalAgentLock,
  createLocalAgentRuntime,
} from '../src/runtime.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function watchFixture({ issueEnabled = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pv-local-agent-runtime-'));
  const config = validateLocalAgentConfig({
    schemaVersion: 1,
    installationId: 'runtime-test',
    dataDir: './data',
    bridge: {
      baseUrl: 'https://bridge.example',
      apiKeyEnv: 'PV_LOCAL_AGENT_API_KEY',
    },
    runtime: {
      pollIntervalMs: 1_000,
      workerBatchSize: 10,
      terminalRedactionDelayMs: 0,
    },
    source: {
      kind: 'watch-folder',
      sourceId: 'runtime-watch',
      profileId: 'runtime-profile',
      root: './files',
      issueEnabled,
      minAgeMs: 0,
    },
  }, { baseDir: root });

  await mkdir(join(config.source.root, 'inbox'), { recursive: true });
  return { root, config };
}

test('Local Agent doctor is non-destructive and only probes bridge readiness + source', async () => {
  const { config } = await watchFixture();
  const calls = [];
  const runtime = createLocalAgentRuntime({
    config,
    env: { PV_LOCAL_AGENT_API_KEY: 'bridge-secret' },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options?.method ?? 'GET' });
      return jsonResponse(200, { status: 'ready' });
    },
  });

  try {
    const doctor = await runtime.doctor();
    assert.equal(doctor.ok, true);
    assert.deepEqual(calls, [{
      url: 'https://bridge.example/readyz',
      method: 'GET',
    }]);
    assert.equal(doctor.checks.some((check) => check.name === 'source-read-only' && check.ok), true);
  } finally {
    await runtime.close();
  }
});

test('Local Agent runOnce feeds watch-folder rows through preflight/issue and redacts terminal payloads', async () => {
  const { config } = await watchFixture();
  await writeFile(
    join(config.source.root, 'inbox', 'invoices.csv'),
    'invoice,total\nF-1,10.50\nF-2,20.75\n',
  );

  const calls = [];
  let issued = 0;
  const runtime = createLocalAgentRuntime({
    config,
    env: { PV_LOCAL_AGENT_API_KEY: 'bridge-secret' },
    fetchImpl: async (url, options = {}) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, method: options.method ?? 'GET' });
      if (path === '/v1/preflight') return jsonResponse(200, { ok: true });
      if (path === '/v1/fiscal-records') {
        issued += 1;
        return jsonResponse(200, { recordId: `record-${issued}`, status: 'accepted' });
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });

  try {
    const result = await runtime.runOnce();
    assert.equal(result.ingested, 1);
    assert.equal(result.processed, 2);
    assert.equal(result.completed, 2);
    assert.equal(result.settled, 1);
    assert.equal(runtime.status().queue.completed, 2);
    assert.equal(issued, 2);

    const jobs = runtime.store.list();
    assert.equal(jobs.length, 2);
    assert.equal(jobs.every((job) => job.redacted === true && job.payload === null), true);

    assert.equal(calls.filter((call) => call.path === '/v1/preflight').length, 2);
    assert.equal(calls.filter((call) => call.path === '/v1/fiscal-records').length, 2);

    const processed = await readdir(join(config.source.root, 'processed'));
    assert.equal(processed.some((name) => name.endsWith('.csv')), true);
  } finally {
    await runtime.close();
  }
});

test('Local Agent start stops cleanly via AbortSignal after one cycle', async () => {
  const { config } = await watchFixture();
  const controller = new AbortController();
  let cycles = 0;
  const runtime = createLocalAgentRuntime({
    config,
    env: { PV_LOCAL_AGENT_API_KEY: 'bridge-secret' },
    fetchImpl: async () => {
      throw new Error('no network operation expected for empty watch folder');
    },
  });

  try {
    await runtime.start({
      signal: controller.signal,
      onCycle: () => {
        cycles += 1;
        controller.abort();
      },
    });
    assert.equal(cycles, 1);
  } finally {
    await runtime.close();
  }
});

test('Local Agent single-instance lock rejects a live owner and can be reacquired after release', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pv-local-agent-lock-'));
  const first = await acquireLocalAgentLock(dataDir);
  await assert.rejects(
    () => acquireLocalAgentLock(dataDir),
    (error) => error.code === 'VF_LOCAL_AGENT_ALREADY_RUNNING',
  );
  await first.release();

  const second = await acquireLocalAgentLock(dataDir);
  await second.release();
});
