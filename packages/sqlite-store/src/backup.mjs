import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_KIND = 'puente-sqlite-backup';
const HASH_CHUNK_BYTES = 1024 * 1024;

function operationalError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function normalizeDiskPath(value, label) {
  const text = String(value ?? '').trim();
  if (!text || text === ':memory:') {
    throw operationalError('VF_SQLITE_DISK_PATH_REQUIRED', `${label} must be a file-backed SQLite path`);
  }
  if (text.includes('\0')) {
    throw operationalError('VF_SQLITE_PATH_INVALID', `${label} contains an invalid NUL byte`);
  }
  return resolve(text);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function hashFile(path) {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  try {
    while (true) {
      const bytes = readSync(fd, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

function syncFile(path) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function syncDirectory(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    fsyncSync(fd);
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function pragmaScalar(db, pragma, column) {
  const row = db.prepare(`PRAGMA ${pragma}`).get();
  return row?.[column] ?? null;
}

export function inspectSqliteFile(path) {
  const resolved = normalizeDiskPath(path, 'SQLite file');
  if (!existsSync(resolved)) {
    throw operationalError('VF_SQLITE_FILE_MISSING', 'SQLite file does not exist', { path: resolved });
  }

  let db;
  try {
    db = new DatabaseSync(resolved);
    db.exec('PRAGMA busy_timeout = 5000');
    const integrityRows = db.prepare('PRAGMA integrity_check').all();
    const integrityMessages = integrityRows.map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? ''));
    if (integrityMessages.length !== 1 || integrityMessages[0].toLowerCase() !== 'ok') {
      throw operationalError('VF_SQLITE_BACKUP_INTEGRITY_FAILED', 'SQLite integrity_check failed', {
        messages: integrityMessages.slice(0, 20),
      });
    }

    const foreignKeyRows = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyRows.length > 0) {
      throw operationalError('VF_SQLITE_BACKUP_FOREIGN_KEY_FAILED', 'SQLite foreign_key_check found violations', {
        violations: foreignKeyRows.slice(0, 20),
      });
    }

    const version = db.prepare('SELECT sqlite_version() AS version').get()?.version ?? null;
    return Object.freeze({
      integrityCheck: 'ok',
      foreignKeyCheck: 'ok',
      sqliteVersion: version == null ? null : String(version),
      userVersion: Number(pragmaScalar(db, 'user_version', 'user_version') ?? 0),
      pageCount: Number(pragmaScalar(db, 'page_count', 'page_count') ?? 0),
    });
  } catch (error) {
    if (String(error?.code ?? '').startsWith('VF_SQLITE_')) throw error;
    throw operationalError('VF_SQLITE_BACKUP_INTEGRITY_FAILED', 'SQLite backup could not be opened or verified', {
      cause: String(error?.message ?? error),
    });
  } finally {
    try { db?.close(); } catch {}
  }
}

function readManifest(manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw operationalError('VF_SQLITE_BACKUP_MANIFEST_INVALID', 'Backup manifest is missing or invalid JSON', {
      cause: String(error?.message ?? error),
    });
  }

  if (manifest?.schema_version !== BACKUP_SCHEMA_VERSION || manifest?.kind !== BACKUP_KIND) {
    throw operationalError('VF_SQLITE_BACKUP_MANIFEST_INVALID', 'Backup manifest schema or kind is unsupported');
  }
  return manifest;
}

export function verifySqliteBackup({ backupPath, manifestPath = `${backupPath}.manifest.json` }) {
  const backup = normalizeDiskPath(backupPath, 'Backup path');
  const manifestFile = normalizeDiskPath(manifestPath, 'Manifest path');
  if (!existsSync(backup)) {
    throw operationalError('VF_SQLITE_BACKUP_MISSING', 'Backup artifact does not exist', { backupPath: backup });
  }
  if (!existsSync(manifestFile)) {
    throw operationalError('VF_SQLITE_BACKUP_MANIFEST_MISSING', 'Backup manifest does not exist', { manifestPath: manifestFile });
  }

  const manifest = readManifest(manifestFile);
  if (manifest.artifact !== basename(backup)) {
    throw operationalError('VF_SQLITE_BACKUP_MANIFEST_MISMATCH', 'Manifest artifact name does not match the backup file');
  }

  const stats = statSync(backup);
  if (Number(manifest.bytes) !== stats.size) {
    throw operationalError('VF_SQLITE_BACKUP_SIZE_MISMATCH', 'Backup byte size does not match its manifest', {
      expected: Number(manifest.bytes),
      actual: stats.size,
    });
  }

  const sha256 = hashFile(backup);
  if (String(manifest.sha256) !== sha256) {
    throw operationalError('VF_SQLITE_BACKUP_CHECKSUM_MISMATCH', 'Backup SHA-256 does not match its manifest', {
      expected: String(manifest.sha256),
      actual: sha256,
    });
  }

  const inspection = inspectSqliteFile(backup);
  return Object.freeze({
    backupPath: backup,
    manifestPath: manifestFile,
    manifest: Object.freeze({ ...manifest }),
    inspection,
    sha256,
    bytes: stats.size,
  });
}

export function createSqliteBackup({
  sourcePath,
  backupPath,
  manifestPath = `${backupPath}.manifest.json`,
  clock = () => new Date(),
}) {
  const source = normalizeDiskPath(sourcePath, 'Source path');
  const backup = normalizeDiskPath(backupPath, 'Backup path');
  const manifestFile = normalizeDiskPath(manifestPath, 'Manifest path');

  if (!existsSync(source)) {
    throw operationalError('VF_SQLITE_SOURCE_MISSING', 'Source SQLite database does not exist', { sourcePath: source });
  }
  if (source === backup || source === manifestFile || backup === manifestFile) {
    throw operationalError('VF_SQLITE_BACKUP_PATH_CONFLICT', 'Source, backup and manifest paths must be distinct');
  }
  if (existsSync(backup) || existsSync(manifestFile)) {
    throw operationalError('VF_SQLITE_BACKUP_EXISTS', 'Backup or manifest already exists; use a new destination to avoid accidental overwrite');
  }

  mkdirSync(dirname(backup), { recursive: true });
  mkdirSync(dirname(manifestFile), { recursive: true });
  const token = `${process.pid}-${randomUUID()}`;
  const tempBackup = resolve(dirname(backup), `.${basename(backup)}.${token}.partial`);
  const tempManifest = resolve(dirname(manifestFile), `.${basename(manifestFile)}.${token}.partial`);
  let publishedBackup = false;
  let db;

  try {
    db = new DatabaseSync(source);
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(`VACUUM INTO ${sqlLiteral(tempBackup)}`);
    db.close();
    db = null;

    chmodSync(tempBackup, 0o600);
    const inspection = inspectSqliteFile(tempBackup);
    const bytes = statSync(tempBackup).size;
    const sha256 = hashFile(tempBackup);
    const createdAt = clock();
    if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
      throw operationalError('VF_SQLITE_BACKUP_CLOCK_INVALID', 'Backup clock must return a valid Date');
    }

    const manifest = {
      schema_version: BACKUP_SCHEMA_VERSION,
      kind: BACKUP_KIND,
      created_at: createdAt.toISOString(),
      artifact: basename(backup),
      source_filename: basename(source),
      bytes,
      sha256,
      sqlite: {
        version: inspection.sqliteVersion,
        user_version: inspection.userVersion,
        page_count: inspection.pageCount,
        integrity_check: inspection.integrityCheck,
        foreign_key_check: inspection.foreignKeyCheck,
      },
    };

    writeFileSync(tempManifest, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    syncFile(tempBackup);
    syncFile(tempManifest);
    renameSync(tempBackup, backup);
    publishedBackup = true;
    renameSync(tempManifest, manifestFile);
    syncDirectory(dirname(backup));
    if (dirname(manifestFile) !== dirname(backup)) syncDirectory(dirname(manifestFile));

    return verifySqliteBackup({ backupPath: backup, manifestPath: manifestFile });
  } catch (error) {
    try { db?.close(); } catch {}
    rmSync(tempBackup, { force: true });
    rmSync(tempManifest, { force: true });
    if (publishedBackup && !existsSync(manifestFile)) rmSync(backup, { force: true });
    if (String(error?.code ?? '').startsWith('VF_SQLITE_')) throw error;
    throw operationalError('VF_SQLITE_BACKUP_FAILED', 'SQLite backup failed', { cause: String(error?.message ?? error) });
  }
}

export function restoreSqliteBackup({
  backupPath,
  manifestPath = `${backupPath}.manifest.json`,
  targetPath,
  replace = false,
  offlineConfirmation = false,
}) {
  const verified = verifySqliteBackup({ backupPath, manifestPath });
  const target = normalizeDiskPath(targetPath, 'Restore target path');
  if (target === verified.backupPath || target === verified.manifestPath) {
    throw operationalError('VF_SQLITE_RESTORE_PATH_CONFLICT', 'Restore target must differ from backup and manifest paths');
  }

  const targetExists = existsSync(target);
  if (targetExists && !replace) {
    throw operationalError('VF_SQLITE_RESTORE_TARGET_EXISTS', 'Restore target already exists; replacement requires explicit replace mode');
  }
  if (targetExists && !offlineConfirmation) {
    throw operationalError('VF_SQLITE_RESTORE_OFFLINE_CONFIRMATION_REQUIRED', 'Replacing an existing database requires explicit confirmation that the application is stopped');
  }
  if (existsSync(`${target}-wal`) || existsSync(`${target}-shm`)) {
    throw operationalError('VF_SQLITE_RESTORE_TARGET_BUSY', 'WAL/SHM sidecars are present; stop the application and complete SQLite shutdown before restore');
  }

  mkdirSync(dirname(target), { recursive: true });
  const tempTarget = resolve(dirname(target), `.${basename(target)}.${process.pid}-${randomUUID()}.restore`);
  try {
    copyFileSync(verified.backupPath, tempTarget);
    chmodSync(tempTarget, 0o600);
    syncFile(tempTarget);

    const inspection = inspectSqliteFile(tempTarget);
    const restoredSha = hashFile(tempTarget);
    if (restoredSha !== verified.sha256) {
      throw operationalError('VF_SQLITE_RESTORE_CHECKSUM_MISMATCH', 'Restore staging copy does not match verified backup checksum');
    }
    if (inspection.integrityCheck !== 'ok' || inspection.foreignKeyCheck !== 'ok') {
      throw operationalError('VF_SQLITE_RESTORE_INTEGRITY_FAILED', 'Restore staging copy failed SQLite verification');
    }

    try {
      renameSync(tempTarget, target);
    } catch (error) {
      throw operationalError('VF_SQLITE_RESTORE_ATOMIC_REPLACE_FAILED', 'Atomic restore replacement failed; the original target was not deliberately removed', {
        cause: String(error?.message ?? error),
      });
    }
    syncDirectory(dirname(target));

    const finalInspection = inspectSqliteFile(target);
    return Object.freeze({
      targetPath: target,
      sha256: restoredSha,
      bytes: statSync(target).size,
      inspection: finalInspection,
      restoredFrom: verified.backupPath,
    });
  } catch (error) {
    rmSync(tempTarget, { force: true });
    if (String(error?.code ?? '').startsWith('VF_SQLITE_')) throw error;
    throw operationalError('VF_SQLITE_RESTORE_FAILED', 'SQLite restore failed', { cause: String(error?.message ?? error) });
  }
}
