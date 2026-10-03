import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseImportFile } from '../../../connectors/file-import/src/file-reader.mjs';

const MANIFEST_SUFFIX = '.pv-manifest.json';
const ERROR_SUFFIX = '.pv-error.json';
const ALLOWED_EXTENSIONS = new Set(['.csv', '.xlsx']);
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ROWS = 10_000;

function fail(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function safeName(name) {
  const value = basename(String(name ?? '')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!value || value === '.' || value === '..') throw fail('VF_LOCAL_AGENT_WATCH_FILE_INVALID', 'Invalid watch-folder filename');
  return value;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function ensurePrivateDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(path, 0o700);
}

async function writePrivateJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  if (process.platform !== 'win32') await chmod(path, 0o600);
}

async function sha256File(path) {
  const hash = createHash('sha256');
  const buffer = await readFile(path);
  hash.update(buffer);
  return { sha256: hash.digest('hex'), buffer };
}

async function uniqueDestination(directory, filename) {
  const direct = join(directory, filename);
  if (!(await exists(direct))) return direct;
  const extension = extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  for (let index = 2; index <= 10_000; index += 1) {
    const candidate = join(directory, `${stem}.${index}${extension}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw fail('VF_LOCAL_AGENT_WATCH_DESTINATION_EXHAUSTED', 'Could not allocate a unique watch-folder destination');
}

function batchId(sourceId, sha256) {
  return `wf_${createHash('sha256').update(`${sourceId}\u0000${sha256}`).digest('hex').slice(0, 32)}`;
}

function rowSourceKey(fileSha256, rowNumber) {
  return `${fileSha256}:row:${rowNumber}`;
}

function publicManifest(manifest) {
  return Object.freeze({
    schemaVersion: manifest.schema_version,
    batchId: manifest.batch_id,
    sourceId: manifest.source_id,
    profileId: manifest.profile_id,
    originalName: manifest.original_name,
    storedName: manifest.stored_name,
    sha256: manifest.sha256,
    format: manifest.format,
    rows: manifest.rows.length,
    state: manifest.state,
    createdAt: manifest.created_at,
    updatedAt: manifest.updated_at,
  });
}

export async function ensureWatchFolderLayout(root) {
  const base = resolve(root);
  const layout = Object.freeze({
    root: base,
    inbox: join(base, 'inbox'),
    processing: join(base, 'processing'),
    processed: join(base, 'processed'),
    error: join(base, 'error'),
  });
  for (const path of Object.values(layout)) await ensurePrivateDir(path);
  return layout;
}

async function loadManifest(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function saveManifest(path, manifest) {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writePrivateJson(temp, manifest);
  await rename(temp, path);
  if (process.platform !== 'win32') await chmod(path, 0o600);
}

async function archivePair(layout, manifestPath, manifest, targetState) {
  const sourceFile = join(layout.processing, manifest.stored_name);
  const targetDir = targetState === 'completed' ? layout.processed : layout.error;
  const fileDestination = manifest.archived_name
    ? join(targetDir, safeName(manifest.archived_name))
    : await uniqueDestination(targetDir, manifest.original_name);
  const manifestDestination = `${fileDestination}${MANIFEST_SUFFIX}`;

  const updated = {
    ...manifest,
    state: targetState,
    archived_name: basename(fileDestination),
    updated_at: new Date().toISOString(),
  };
  await saveManifest(manifestPath, updated);

  if (await exists(sourceFile)) {
    if (await exists(fileDestination)) {
      throw fail('VF_LOCAL_AGENT_WATCH_ARCHIVE_CONFLICT', 'Watch-folder archive destination already exists', {
        batchId: manifest.batch_id,
      });
    }
    await rename(sourceFile, fileDestination);
  } else if (!(await exists(fileDestination))) {
    throw fail('VF_LOCAL_AGENT_WATCH_SOURCE_MISSING', 'Watch-folder source disappeared before archive could finish', {
      batchId: manifest.batch_id,
    });
  }

  if (!(await exists(manifestDestination))) await rename(manifestPath, manifestDestination);
  return publicManifest(updated);
}

async function stageProcessingFile({
  store,
  layout,
  processingPath,
  sourceId,
  profileId,
  originalName,
  fileSha256,
  buffer,
  sheet,
  headerRow,
  maxRows = DEFAULT_MAX_ROWS,
  now,
}) {
  const storedName = basename(processingPath);
  const manifestPath = `${processingPath}${MANIFEST_SUFFIX}`;

  if (await exists(manifestPath)) return publicManifest(await loadManifest(manifestPath));

  let parsed;
  try {
    parsed = parseImportFile(buffer ?? await readFile(processingPath), {
      filename: originalName,
      sheet,
      headerRow,
      maxRows,
    });
  } catch (error) {
    const destination = await uniqueDestination(layout.error, originalName);
    const report = {
      schema_version: 1,
      kind: 'puente-verifactu-local-agent-watch-error',
      stage: 'parse',
      source_id: sourceId,
      original_name: originalName,
      stored_name: storedName,
      sha256: fileSha256,
      code: String(error?.code ?? 'VF_LOCAL_AGENT_WATCH_PARSE_FAILED'),
      message: String(error?.message ?? 'Watch-folder parse failed').slice(0, 500),
      created_at: new Date(now).toISOString(),
    };
    await rename(processingPath, destination);
    await writePrivateJson(`${destination}${ERROR_SUFFIX}`, report);
    return Object.freeze({
      schemaVersion: 1,
      batchId: batchId(sourceId, fileSha256),
      sourceId,
      profileId,
      originalName,
      storedName,
      sha256: fileSha256,
      format: null,
      rows: 0,
      state: 'blocked',
      createdAt: report.created_at,
      updatedAt: report.created_at,
    });
  }

  if (Array.isArray(parsed.rows) && parsed.rows.length > Number(maxRows)) {
    const destination = await uniqueDestination(layout.error, originalName);
    const report = {
      schema_version: 1,
      kind: 'puente-verifactu-local-agent-watch-error',
      stage: 'parse',
      source_id: sourceId,
      original_name: originalName,
      stored_name: storedName,
      sha256: fileSha256,
      code: 'VF_LOCAL_AGENT_WATCH_ROW_LIMIT',
      message: `The watch-folder file exceeds the safe row limit (${maxRows})`,
      created_at: new Date(now).toISOString(),
    };
    await rename(processingPath, destination);
    await writePrivateJson(`${destination}${ERROR_SUFFIX}`, report);
    return Object.freeze({
      schemaVersion: 1,
      batchId: batchId(sourceId, fileSha256),
      sourceId,
      profileId,
      originalName,
      storedName,
      sha256: fileSha256,
      format: parsed.format ?? null,
      rows: 0,
      state: 'blocked',
      createdAt: report.created_at,
      updatedAt: report.created_at,
    });
  }

  if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
    const destination = await uniqueDestination(layout.error, originalName);
    const report = {
      schema_version: 1,
      kind: 'puente-verifactu-local-agent-watch-error',
      stage: 'parse',
      source_id: sourceId,
      original_name: originalName,
      stored_name: storedName,
      sha256: fileSha256,
      code: 'VF_LOCAL_AGENT_WATCH_FILE_EMPTY',
      message: 'The watch-folder file contains no invoice rows',
      created_at: new Date(now).toISOString(),
    };
    await rename(processingPath, destination);
    await writePrivateJson(`${destination}${ERROR_SUFFIX}`, report);
    return Object.freeze({
      schemaVersion: 1,
      batchId: batchId(sourceId, fileSha256),
      sourceId,
      profileId,
      originalName,
      storedName,
      sha256: fileSha256,
      format: parsed.format ?? null,
      rows: 0,
      state: 'blocked',
      createdAt: report.created_at,
      updatedAt: report.created_at,
    });
  }

  const rows = [];
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const rowNumber = index + Number(parsed.headerRow ?? 1) + 1;
    const job = store.enqueue({
      sourceId,
      sourceKey: rowSourceKey(fileSha256, rowNumber),
      payload: {
        kind: 'mapped-source',
        profileId,
        source: parsed.rows[index],
        localAgent: {
          channel: 'watch-folder',
          fileSha256,
          originalName,
          rowNumber,
        },
      },
      now,
      availableAt: now,
    });
    rows.push({
      row: rowNumber,
      job_id: job.id,
      idempotency_key: job.idempotencyKey,
    });
  }

  const timestamp = new Date(now).toISOString();
  const manifest = {
    schema_version: 1,
    kind: 'puente-verifactu-local-agent-watch-batch',
    batch_id: batchId(sourceId, fileSha256),
    source_id: sourceId,
    profile_id: profileId,
    original_name: originalName,
    stored_name: storedName,
    sha256: fileSha256,
    format: parsed.format,
    sheet_name: parsed.sheetName ?? null,
    header_row: parsed.headerRow ?? 1,
    state: 'processing',
    rows,
    created_at: timestamp,
    updated_at: timestamp,
  };
  await writePrivateJson(manifestPath, manifest);
  return publicManifest(manifest);
}

export async function ingestWatchFolder({
  store,
  root,
  sourceId = 'watch-folder',
  profileId,
  issueEnabled = false,
  minAgeMs = 2_000,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  maxRows = DEFAULT_MAX_ROWS,
  sheet,
  headerRow,
  now = Date.now(),
} = {}) {
  if (!store) throw new TypeError('store is required');
  if (!String(profileId ?? '').trim()) throw fail('VF_LOCAL_AGENT_PROFILE_REQUIRED', 'profileId is required');
  if (!Number.isFinite(Number(maxFileBytes)) || Number(maxFileBytes) < 1) {
    throw fail('VF_LOCAL_AGENT_WATCH_LIMIT_INVALID', 'maxFileBytes must be a positive number');
  }
  if (!Number.isInteger(Number(maxRows)) || Number(maxRows) < 1) {
    throw fail('VF_LOCAL_AGENT_WATCH_LIMIT_INVALID', 'maxRows must be a positive integer');
  }
  if (issueEnabled !== true) {
    throw fail(
      'VF_LOCAL_AGENT_WATCH_ISSUE_NOT_ENABLED',
      'Watch-folder issuance is disabled until issueEnabled=true is explicitly configured',
    );
  }

  const layout = await ensureWatchFolderLayout(root);
  const entries = await readdir(layout.inbox, { withFileTypes: true });
  const staged = [];
  const skipped = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) continue;
    if (!ALLOWED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      skipped.push({ name: entry.name, reason: 'unsupported_extension' });
      continue;
    }

    const name = safeName(entry.name);
    const inboxPath = join(layout.inbox, name);
    const info = await stat(inboxPath);
    if (Number(info.size) > Number(maxFileBytes)) {
      const destination = await uniqueDestination(layout.error, name);
      await rename(inboxPath, destination);
      if (process.platform !== 'win32') await chmod(destination, 0o600);
      const createdAt = new Date(Number(now)).toISOString();
      await writePrivateJson(`${destination}${ERROR_SUFFIX}`, {
        schema_version: 1,
        kind: 'puente-verifactu-local-agent-watch-error',
        stage: 'limits',
        source_id: String(sourceId),
        original_name: name,
        size: Number(info.size),
        code: 'VF_LOCAL_AGENT_WATCH_FILE_TOO_LARGE',
        message: `Watch-folder file exceeds ${maxFileBytes} bytes`,
        created_at: createdAt,
      });
      staged.push(Object.freeze({
        schemaVersion: 1,
        batchId: null,
        sourceId: String(sourceId),
        profileId: String(profileId),
        originalName: name,
        storedName: basename(destination),
        sha256: null,
        format: extname(name).slice(1).toLowerCase(),
        rows: 0,
        state: 'blocked',
        createdAt,
        updatedAt: createdAt,
      }));
      continue;
    }
    if (Number(minAgeMs) > 0 && Number(info.mtimeMs) > Number(now) - Number(minAgeMs)) {
      skipped.push({ name, reason: 'not_stable_yet' });
      continue;
    }

    const { sha256, buffer } = await sha256File(inboxPath);
    const storedName = `${sha256.slice(0, 16)}--${name}`;
    let processingPath = join(layout.processing, storedName);
    if (await exists(processingPath)) processingPath = await uniqueDestination(layout.processing, storedName);

    await rename(inboxPath, processingPath);
    if (process.platform !== 'win32') await chmod(processingPath, 0o600);

    staged.push(await stageProcessingFile({
      store,
      layout,
      processingPath,
      sourceId: String(sourceId),
      profileId: String(profileId),
      originalName: name,
      fileSha256: sha256,
      buffer,
      sheet,
      headerRow,
      maxRows: Number(maxRows),
      now: Number(now),
    }));
  }

  return Object.freeze({
    root: layout.root,
    staged: Object.freeze(staged),
    skipped: Object.freeze(skipped),
  });
}

export async function settleWatchFolder({ store, root } = {}) {
  if (!store) throw new TypeError('store is required');
  const layout = await ensureWatchFolderLayout(root);
  const entries = await readdir(layout.processing, { withFileTypes: true });
  const settled = [];
  const pending = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith(MANIFEST_SUFFIX)) continue;
    const manifestPath = join(layout.processing, entry.name);
    const manifest = await loadManifest(manifestPath);
    const jobs = manifest.rows.map((row) => store.get(row.job_id)).filter(Boolean);

    if (jobs.length !== manifest.rows.length) {
      throw fail('VF_LOCAL_AGENT_WATCH_JOB_MISSING', 'Watch-folder manifest references missing queue jobs', {
        batchId: manifest.batch_id,
      });
    }

    const active = jobs.filter((job) => job.state === 'pending' || job.state === 'processing');
    if (active.length > 0) {
      pending.push(publicManifest(manifest));
      continue;
    }

    const blocked = jobs.filter((job) => job.state === 'blocked');
    settled.push(await archivePair(
      layout,
      manifestPath,
      {
        ...manifest,
        completed_rows: jobs.filter((job) => job.state === 'completed').length,
        blocked_rows: blocked.length,
        blocked_codes: [...new Set(blocked.map((job) => job.error?.code).filter(Boolean))].slice(0, 20),
      },
      blocked.length > 0 ? 'blocked' : 'completed',
    ));
  }

  return Object.freeze({
    settled: Object.freeze(settled),
    pending: Object.freeze(pending),
  });
}

export async function recoverProcessingWatchFiles({
  store,
  root,
  sourceId = 'watch-folder',
  profileId,
  issueEnabled = false,
  sheet,
  headerRow,
  maxRows = DEFAULT_MAX_ROWS,
  now = Date.now(),
} = {}) {
  if (!store) throw new TypeError('store is required');
  if (!String(profileId ?? '').trim()) throw fail('VF_LOCAL_AGENT_PROFILE_REQUIRED', 'profileId is required');
  if (!Number.isInteger(Number(maxRows)) || Number(maxRows) < 1) {
    throw fail('VF_LOCAL_AGENT_WATCH_LIMIT_INVALID', 'maxRows must be a positive integer');
  }
  if (issueEnabled !== true) {
    throw fail('VF_LOCAL_AGENT_WATCH_ISSUE_NOT_ENABLED', 'Watch-folder issuance is disabled');
  }

  const layout = await ensureWatchFolderLayout(root);
  const entries = await readdir(layout.processing, { withFileTypes: true });
  const recovered = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || entry.name.endsWith(MANIFEST_SUFFIX)) continue;
    if (!ALLOWED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;

    const processingPath = join(layout.processing, entry.name);
    const manifestPath = `${processingPath}${MANIFEST_SUFFIX}`;
    if (await exists(manifestPath)) continue;

    const { sha256, buffer } = await sha256File(processingPath);
    const separator = entry.name.indexOf('--');
    const originalName = separator > 0 ? entry.name.slice(separator + 2) : entry.name;

    recovered.push(await stageProcessingFile({
      store,
      layout,
      processingPath,
      sourceId: String(sourceId),
      profileId: String(profileId),
      originalName,
      fileSha256: sha256,
      buffer,
      sheet,
      headerRow,
      maxRows: Number(maxRows),
      now: Number(now),
    }));
  }

  return Object.freeze(recovered);
}
