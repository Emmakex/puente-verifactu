#!/usr/bin/env node
import { resolve } from 'node:path';
import { prepareLocalAgentUpgrade } from './upgrade.mjs';

function fail(code, message) {
  throw Object.assign(new Error(message), { code, retryable: false });
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const values = new Map();

  while (args.length > 0) {
    const flag = args.shift();
    if (!flag?.startsWith('--')) throw fail('VF_LOCAL_AGENT_UPGRADE_CLI_ARGUMENT_INVALID', 'Invalid argument');
    const value = args.shift();
    if (!value) throw fail('VF_LOCAL_AGENT_UPGRADE_CLI_ARGUMENT_INVALID', `${flag} requires a value`);
    values.set(flag, value);
  }

  if (command !== 'prepare') {
    throw fail(
      'VF_LOCAL_AGENT_UPGRADE_CLI_USAGE',
      'Usage: upgrade-cli prepare --manifest <path> --config <path> [--backup-dir <path>]',
    );
  }

  const manifestPath = values.get('--manifest');
  const configPath = values.get('--config');
  if (!manifestPath || !configPath) {
    throw fail('VF_LOCAL_AGENT_UPGRADE_CLI_ARGUMENT_INVALID', '--manifest and --config are required');
  }

  return {
    manifestPath: resolve(manifestPath),
    configPath: resolve(configPath),
    backupDir: values.get('--backup-dir') ? resolve(values.get('--backup-dir')) : null,
  };
}

function safeError(error) {
  const code = String(error?.code ?? 'VF_LOCAL_AGENT_UPGRADE_ERROR');
  return {
    code,
    message: code.startsWith('VF_LOCAL_AGENT_')
      ? String(error?.message ?? 'Local Agent upgrade failed').slice(0, 300)
      : 'Local Agent upgrade failed',
    retryable: false,
    ...(error?.details && typeof error.details === 'object' ? { details: error.details } : {}),
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await prepareLocalAgentUpgrade(options);
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({
    schemaVersion: 1,
    status: 'blocked',
    error: safeError(error),
  }) + '\n');
  process.exitCode = 1;
}
