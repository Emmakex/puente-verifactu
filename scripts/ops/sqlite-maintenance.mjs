#!/usr/bin/env node

import {
  createSqliteBackup,
  restoreSqliteBackup,
  verifySqliteBackup,
} from '../../packages/sqlite-store/src/backup.mjs';

function usage() {
  return [
    'Usage:',
    '  node scripts/ops/sqlite-maintenance.mjs backup --db <source.sqlite> --out <backup.sqlite>',
    '  node scripts/ops/sqlite-maintenance.mjs verify --backup <backup.sqlite> [--manifest <manifest.json>]',
    '  node scripts/ops/sqlite-maintenance.mjs restore --backup <backup.sqlite> --db <target.sqlite> [--manifest <manifest.json>] [--replace --offline-confirmation]',
    '',
    'Safety:',
    '  - backup never overwrites an existing artifact or manifest;',
    '  - restore verifies checksum + SQLite integrity before touching the target;',
    '  - replacing an existing target requires both --replace and --offline-confirmation;',
    '  - restore refuses targets with active WAL/SHM sidecars.',
  ].join('\n');
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      throw Object.assign(new Error(`Unexpected argument: ${token}`), { code: 'VF_SQLITE_CLI_ARGUMENT_INVALID' });
    }
    const key = token.slice(2);
    if (key === 'replace' || key === 'offline-confirmation') {
      options[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) {
      throw Object.assign(new Error(`Missing value for --${key}`), { code: 'VF_SQLITE_CLI_ARGUMENT_INVALID' });
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function required(options, key) {
  const value = options[key];
  if (!value) throw Object.assign(new Error(`Missing required --${key}`), { code: 'VF_SQLITE_CLI_ARGUMENT_REQUIRED' });
  return value;
}

function printable(result, action) {
  return {
    schema_version: 1,
    status: 'ok',
    action,
    backup: result.backupPath ?? result.restoredFrom ?? null,
    target: result.targetPath ?? null,
    manifest: result.manifestPath ?? null,
    bytes: result.bytes,
    sha256: result.sha256,
    integrity_check: result.inspection?.integrityCheck ?? null,
    foreign_key_check: result.inspection?.foreignKeyCheck ?? null,
  };
}

try {
  const { command, options } = parseArgs(process.argv.slice(2));
  let result;

  if (command === 'backup') {
    const backupPath = required(options, 'out');
    result = createSqliteBackup({
      sourcePath: required(options, 'db'),
      backupPath,
      manifestPath: options.manifest ?? `${backupPath}.manifest.json`,
    });
    console.log(JSON.stringify(printable(result, 'backup'), null, 2));
  } else if (command === 'verify') {
    const backupPath = required(options, 'backup');
    result = verifySqliteBackup({
      backupPath,
      manifestPath: options.manifest ?? `${backupPath}.manifest.json`,
    });
    console.log(JSON.stringify(printable(result, 'verify'), null, 2));
  } else if (command === 'restore') {
    const backupPath = required(options, 'backup');
    result = restoreSqliteBackup({
      backupPath,
      manifestPath: options.manifest ?? `${backupPath}.manifest.json`,
      targetPath: required(options, 'db'),
      replace: options.replace === true,
      offlineConfirmation: options['offline-confirmation'] === true,
    });
    console.log(JSON.stringify(printable(result, 'restore'), null, 2));
  } else {
    throw Object.assign(new Error(command ? `Unknown command: ${command}` : 'A command is required'), {
      code: 'VF_SQLITE_CLI_USAGE',
    });
  }
} catch (error) {
  const code = String(error?.code ?? 'VF_SQLITE_MAINTENANCE_FAILED');
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    code,
    message: String(error?.message ?? error),
    details: error?.details ?? null,
  }, null, 2));
  if (code === 'VF_SQLITE_CLI_USAGE' || code.startsWith('VF_SQLITE_CLI_ARGUMENT')) {
    console.error(`\n${usage()}`);
  }
  process.exitCode = 1;
}
