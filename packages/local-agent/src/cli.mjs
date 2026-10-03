#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { LocalAgentStore } from './store.mjs';
import { loadLocalAgentConfig } from './config.mjs';
import { acquireLocalAgentLock, createLocalAgentRuntime } from './runtime.mjs';

function output(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

function outputError(error) {
  process.stderr.write(JSON.stringify({
    schemaVersion: 1,
    status: 'error',
    error: {
      code: String(error?.code ?? 'VF_LOCAL_AGENT_CLI_ERROR'),
      message: String(error?.message ?? 'Local Agent command failed').slice(0, 300),
      retryable: Boolean(error?.retryable),
    },
  }) + '\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  let configPath = process.env.PV_LOCAL_AGENT_CONFIG || null;

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === '--config') {
      configPath = args.shift() ?? null;
      continue;
    }
    throw Object.assign(new Error(`Unknown argument: ${flag}`), {
      code: 'VF_LOCAL_AGENT_CLI_ARGUMENT_INVALID',
    });
  }

  if (!['start', 'once', 'status', 'doctor'].includes(command)) {
    throw Object.assign(new Error('Usage: local-agent <start|once|status|doctor> --config <path>'), {
      code: 'VF_LOCAL_AGENT_CLI_USAGE',
    });
  }
  if (!configPath) {
    throw Object.assign(new Error('--config or PV_LOCAL_AGENT_CONFIG is required'), {
      code: 'VF_LOCAL_AGENT_CLI_CONFIG_REQUIRED',
    });
  }
  return { command, configPath: resolve(configPath) };
}

async function localStatus(config) {
  const store = new LocalAgentStore(join(config.dataDir, 'agent.sqlite'));
  try {
    return Object.freeze({
      schemaVersion: 1,
      installationId: config.installationId,
      sourceKind: config.source.kind,
      issueEnabled: config.source.issueEnabled,
      queue: store.stats(),
      checkpoint: config.source.kind === 'database'
        ? store.getCheckpoint(config.source.sourceId)
        : null,
    });
  } finally {
    store.close();
  }
}

async function run() {
  const { command, configPath } = parseArgs(process.argv.slice(2));
  const config = await loadLocalAgentConfig(configPath);

  if (command === 'status') {
    output({ status: 'ok', ...await localStatus(config) });
    return;
  }

  const runtime = createLocalAgentRuntime({
    config,
    log: (event) => output({ status: 'event', ...event }),
  });

  if (command === 'doctor') {
    try {
      const result = await runtime.doctor();
      output({ status: result.ok ? 'ok' : 'failed', ...result });
      if (!result.ok) process.exitCode = 2;
    } finally {
      await runtime.close();
    }
    return;
  }

  const lock = await acquireLocalAgentLock(config.dataDir);
  try {
    if (command === 'once') {
      try {
        output({ status: 'ok', result: await runtime.runOnce() });
      } finally {
        await runtime.close();
      }
      return;
    }

    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      await runtime.start({
        signal: controller.signal,
        onCycle: (result) => output({ status: result?.error ? 'cycle_error' : 'cycle_ok', result }),
      });
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      await runtime.close();
    }
  } finally {
    await lock.release();
  }
}

run().catch((error) => {
  outputError(error);
  process.exitCode = 1;
});
