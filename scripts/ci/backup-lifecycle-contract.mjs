import { existsSync, readFileSync } from 'node:fs';

const required = [
  'config/backup-policy.example.json',
  'docs/backup-lifecycle-policy.md',
  'packages/sqlite-store/src/backup-lifecycle.mjs',
  'packages/sqlite-store/test/backup-lifecycle.test.mjs',
  'scripts/ops/backup-lifecycle.mjs',
];

const failures = [];
for (const path of required) {
  if (!existsSync(path)) failures.push({ code: 'BACKUP_LIFECYCLE_REQUIRED_PATH_MISSING', path });
}

try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const expected = {
    'backup:lifecycle:smoke': 'node --test packages/sqlite-store/test/backup-lifecycle.test.mjs',
    'backup:lifecycle:check': 'node scripts/ops/backup-lifecycle.mjs check',
    'backup:restore-drill': 'node scripts/ops/backup-lifecycle.mjs restore-drill',
  };
  for (const [name, command] of Object.entries(expected)) {
    if (pkg?.scripts?.[name] !== command) failures.push({ code: 'BACKUP_LIFECYCLE_SCRIPT_MISSING', name, expected: command });
  }
  if (!String(pkg?.scripts?.check ?? '').includes('backup-lifecycle-contract.mjs')) {
    failures.push({ code: 'BACKUP_LIFECYCLE_GATE_NOT_CHAINED_TO_CHECK' });
  }
} catch (error) {
  failures.push({ code: 'BACKUP_LIFECYCLE_PACKAGE_INVALID', message: error.message });
}

const docs = existsSync('docs/backup-lifecycle-policy.md') ? readFileSync('docs/backup-lifecycle-policy.md', 'utf8') : '';
for (const marker of [
  'copia remota cifrada',
  '7 diarios, 5 semanales y 12 mensuales',
  'restore drill',
  'no borra backups automáticamente',
  'puente-backup-remote-evidence',
  'npm run backup:lifecycle:check',
]) {
  if (!docs.includes(marker)) failures.push({ code: 'BACKUP_LIFECYCLE_DOC_INCOMPLETE', marker });
}

const implementation = existsSync('packages/sqlite-store/src/backup-lifecycle.mjs')
  ? readFileSync('packages/sqlite-store/src/backup-lifecycle.mjs', 'utf8')
  : '';
for (const marker of [
  'VF_BACKUP_REMOTE_COPY_MISSING',
  'VF_BACKUP_REMOTE_COPY_NOT_ENCRYPTED',
  'VF_BACKUP_RESTORE_DRILL_TOO_OLD',
  'pruneCandidates',
]) {
  if (!implementation.includes(marker)) failures.push({ code: 'BACKUP_LIFECYCLE_IMPLEMENTATION_GUARD_MISSING', marker });
}

const cli = existsSync('scripts/ops/backup-lifecycle.mjs') ? readFileSync('scripts/ops/backup-lifecycle.mjs', 'utf8') : '';
for (const marker of ['restore-drill', 'mkdtempSync', 'verifySqliteBackup', 'restoreSqliteBackup']) {
  if (!cli.includes(marker)) failures.push({ code: 'BACKUP_LIFECYCLE_DRILL_GUARD_MISSING', marker });
}

if (failures.length > 0) {
  console.error(JSON.stringify({ schema_version: 1, status: 'failed', check: 'backup-lifecycle-contract', failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'backup-lifecycle-contract',
  required_paths: required.length,
}, null, 2));
