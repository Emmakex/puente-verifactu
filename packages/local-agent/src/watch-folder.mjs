import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const DEFAULT_EXTENSIONS = Object.freeze(['.csv', '.xlsx']);

async function fileSha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function scanWatchFolder(directory, { extensions = DEFAULT_EXTENSIONS } = {}) {
  const root = resolve(directory);
  const allowed = new Set(extensions.map((value) => String(value).toLowerCase()));
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (!allowed.has(extension)) continue;
    const path = join(root, entry.name);
    const info = await stat(path);
    const digest = await fileSha256(path);
    files.push(Object.freeze({
      name: entry.name,
      path,
      extension,
      size: Number(info.size),
      modifiedAt: Number(info.mtimeMs),
      sha256: digest,
      sourceKey: `${entry.name}:${digest}`,
    }));
  }

  return Object.freeze(files);
}

export async function enqueueWatchFolder({
  store,
  directory,
  sourceId = 'watch-folder',
  extensions = DEFAULT_EXTENSIONS,
  now = Date.now(),
} = {}) {
  if (!store) throw new TypeError('store is required');
  const files = await scanWatchFolder(directory, { extensions });
  const jobs = [];
  for (const file of files) {
    jobs.push(store.enqueue({
      sourceId,
      sourceKey: file.sourceKey,
      payload: {
        kind: 'watch-file',
        filename: file.name,
        path: file.path,
        extension: file.extension,
        size: file.size,
        sha256: file.sha256,
      },
      now,
      availableAt: now,
    }));
  }
  return Object.freeze({ files: files.length, jobs: Object.freeze(jobs) });
}

export { DEFAULT_EXTENSIONS as WATCH_FOLDER_EXTENSIONS };
