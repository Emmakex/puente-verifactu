import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const DEFAULT_EXTENSIONS = Object.freeze(['.csv', '.xlsx']);

async function fileSha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
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

export { DEFAULT_EXTENSIONS as WATCH_FOLDER_EXTENSIONS };
