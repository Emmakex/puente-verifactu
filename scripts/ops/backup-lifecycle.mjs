#!/usr/bin/env node

import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { restoreSqliteBackup, verifySqliteBackup } from '../../packages/sqlite-store/src/backup.mjs';
import { evaluateBackupLifecycle, loadBackupLifecyclePolicy } from '../../packages/sqlite-store/src/backup-lifecycle.mjs';

function error(code, message) {
  return Object.assign(new Error(message), { code });
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw error('VF_BACKUP_LIFECYCLE_ARGUMENT_INVALID', `Unexpected argument: ${token}`);
    const name = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw error('VF_BACKUP_LIFECYCLE_ARGUMENT_INVALID', `Missing value for --${name}`);
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

function required(options, name) {
  const value = options[name];
  if (!value) throw error('VF_BACKUP_LIFECYCLE_ARGUMENT_REQUIRED', `Missing required --${name}`);
  return value;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/ops/backup-lifecycle.mjs check --dir <backup-dir> --policy <policy.json> --remote-evidence <remote.json> --restore-drill-evidence <drill.json>',
    '  node scripts/ops/backup-lifecycle.mjs restore-drill --backup <backup.sqlite> --evidence <drill.json>',
    '',
    'The check command is read-only. It never deletes retention candidates.',
    'The restore-drill command restores only into a temporary directory, verifies it, writes evidence, and removes the temporary copy.',
  ].join('\n');
}

function safeFailure(errorInput) {
  return {
    schema_version: 1,
    status: 'failed',
    code: String(errorInput?.code ?? 'VF_BACKUP_LIFECYCLE_FAILED'),
    message: String(errorInput?.message ?? errorInput),
  };
}

export function performRestoreDrill({ backupPath, evidencePath, clock = () => new Date() }) {
  const backup = resolve(String(backupPath ?? ''));
  const evidence = resolve(String(evidencePath ?? ''));
  if (existsSync(evidence)) throw error('VF_BACKUP_RESTORE_DRILL_EVIDENCE_EXISTS', 'Restore drill evidence already exists; use a new path');

  const verified = verifySqliteBackup({ backupPath: backup });
  const performedAt = clock();
  if (!(performedAt instanceof Date) || Number.isNaN(performedAt.getTime())) {
    throw error('VF_BACKUP_RESTORE_DRILL_CLOCK_INVALID', 'Restore drill clock must return a valid Date');
  }

  const directory = mkdtempSync(join(tmpdir(), 'puente-verifactu-restore-drill-'));
  const target = join(directory, 'restored.sqlite');
  try {
    const restored = restoreSqliteBackup({ backupPath: backup, targetPath: target });
    if (restored.sha256 !== verified.sha256 || restored.inspection.integrityCheck !== 'ok' || restored.inspection.foreignKeyCheck !== 'ok') {
      throw error('VF_BACKUP_RESTORE_DRILL_VERIFICATION_FAILED', 'Restore drill staging verification failed');
    }

    const receipt = {
      schema_version: 1,
      kind: 'puente-backup-restore-drill',
      performed_at: performedAt.toISOString(),
      backup_sha256: verified.sha256,
      result: 'ok',
      checks: {
        checksum: 'ok',
        integrity_check: restored.inspection.integrityCheck,
        foreign_key_check: restored.inspection.foreignKeyCheck,
      },
    };
    writeFileSync(evidence, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    chmodSync(evidence, 0o600);
    return Object.freeze(receipt);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function runBackupLifecycle(argv, { stdout = console.log, stderr = console.error } = {}) {
  try {
    const { command, options } = parseArgs(argv);
    if (command === 'check') {
      const policy = loadBackupLifecyclePolicy(required(options, 'policy'));
      const report = evaluateBackupLifecycle({
        directory: required(options, 'dir'),
        policy,
        remoteEvidencePath: required(options, 'remote-evidence'),
        restoreDrillEvidencePath: required(options, 'restore-drill-evidence'),
      });
      stdout(JSON.stringify(report, null, 2));
      return report.status === 'ok' ? 0 : 2;
    }
    if (command === 'restore-drill') {
      const receipt = performRestoreDrill({
        backupPath: required(options, 'backup'),
        evidencePath: required(options, 'evidence'),
      });
      stdout(JSON.stringify(receipt, null, 2));
      return 0;
    }
    throw error('VF_BACKUP_LIFECYCLE_USAGE', command ? `Unknown command: ${command}` : 'A command is required');
  } catch (caught) {
    stderr(JSON.stringify(safeFailure(caught), null, 2));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const exitCode = runBackupLifecycle(process.argv.slice(2));
  if (exitCode !== 0) console.error(`\n${usage()}`);
  process.exitCode = exitCode;
}
