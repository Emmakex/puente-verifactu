import { createHash, timingSafeEqual } from 'node:crypto';
import { chmod, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, posix, resolve } from 'node:path';
import { ensureWatchFolderLayout } from './watch-ingest.mjs';
import { stableStringify } from '../../core/src/idempotency.mjs';

const ALLOWED_EXTENSIONS = new Set(['.csv', '.xlsx']);
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

function fail(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details, retryable: false });
}

function text(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw fail('VF_LOCAL_AGENT_SFTP_INPUT_INVALID', `${name} is required`);
  return normalized;
}

function normalizeRemoteDirectory(value) {
  const directory = text(value, 'remoteDirectory').replace(/\\/g, '/');
  if (directory.includes('\u0000')) {
    throw fail('VF_LOCAL_AGENT_SFTP_PATH_INVALID', 'remoteDirectory contains an invalid byte');
  }
  return directory;
}

function safeRemoteName(value) {
  const name = text(value, 'remote filename');
  if (
    name !== basename(name)
    || name.includes('/')
    || name.includes('\\')
    || name === '.'
    || name === '..'
    || /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw fail('VF_LOCAL_AGENT_SFTP_PATH_INVALID', 'Remote filename is unsafe');
  }
  return name;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeModifiedAt(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return number > 0 && number < 100_000_000_000 ? number * 1000 : number;
}

function sourceKeyFor({ remoteDirectory, name, fingerprint }) {
  return `sftp:${sha256Hex(stableStringify({
    remoteDirectory,
    name,
    fingerprint,
  }))}`;
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

async function localDestination(inbox, name, sourceKey) {
  const direct = join(inbox, name);
  if (!(await exists(direct))) return direct;
  return join(inbox, `sftp-${sourceKey.slice(-12)}--${name}`);
}

function decodePinnedSha256(value) {
  const fingerprint = text(value, 'hostKeySha256');
  if (/^[a-f0-9]{64}$/i.test(fingerprint)) return Buffer.from(fingerprint.toLowerCase(), 'hex');

  if (fingerprint.startsWith('SHA256:')) {
    const encoded = fingerprint.slice('SHA256:'.length);
    try {
      const decoded = Buffer.from(encoded, 'base64');
      if (decoded.length === 32) return decoded;
    } catch {}
  }

  throw fail(
    'VF_LOCAL_AGENT_SFTP_HOST_KEY_INVALID',
    'hostKeySha256 must be a 64-character hex digest or OpenSSH SHA256 fingerprint',
  );
}

export function createPinnedSftpHostVerifier(hostKeySha256) {
  const expected = decodePinnedSha256(hostKeySha256);
  return (actualHex) => {
    if (typeof actualHex !== 'string' || !/^[a-f0-9]{64}$/i.test(actualHex)) return false;
    const actual = Buffer.from(actualHex, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
}

export function createSftpConnectionConfig({
  host,
  port = 22,
  username,
  password,
  privateKey,
  passphrase,
  hostKeySha256,
  readyTimeout = 20_000,
  serverHostKeyAlgorithms,
} = {}) {
  const normalizedHost = text(host, 'host');
  const normalizedUsername = text(username, 'username');
  const normalizedPort = Number(port);
  const timeout = Number(readyTimeout);

  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    throw fail('VF_LOCAL_AGENT_SFTP_INPUT_INVALID', 'port must be between 1 and 65535');
  }
  if (!Number.isFinite(timeout) || timeout < 1_000 || timeout > 120_000) {
    throw fail('VF_LOCAL_AGENT_SFTP_INPUT_INVALID', 'readyTimeout must be between 1000 and 120000ms');
  }
  if (password == null && privateKey == null) {
    throw fail('VF_LOCAL_AGENT_SFTP_AUTH_REQUIRED', 'password or privateKey is required');
  }
  if (
    serverHostKeyAlgorithms != null
    && (!Array.isArray(serverHostKeyAlgorithms)
      || serverHostKeyAlgorithms.length === 0
      || serverHostKeyAlgorithms.some((value) => !String(value ?? '').trim()))
  ) {
    throw fail('VF_LOCAL_AGENT_SFTP_INPUT_INVALID', 'serverHostKeyAlgorithms must be a non-empty array');
  }

  const config = {
    host: normalizedHost,
    port: normalizedPort,
    username: normalizedUsername,
    readyTimeout: timeout,
    hostHash: 'sha256',
    hostVerifier: createPinnedSftpHostVerifier(hostKeySha256),
  };
  if (serverHostKeyAlgorithms != null) {
    config.algorithms = {
      serverHostKey: serverHostKeyAlgorithms.map((value) => String(value).trim()),
    };
  }
  if (password != null) config.password = String(password);
  if (privateKey != null) config.privateKey = privateKey;
  if (passphrase != null) config.passphrase = String(passphrase);
  return config;
}

export async function syncSftpDropFolder({
  store,
  client,
  root,
  remoteDirectory,
  sourceId = 'sftp-drop-folder',
  issueEnabled = false,
  minAgeMs = 2_000,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  now = Date.now(),
} = {}) {
  if (!store || typeof store.getSourceReceipt !== 'function' || typeof store.recordSourceReceipt !== 'function') {
    throw new TypeError('Local Agent store with durable source receipts is required');
  }
  if (!client || typeof client.list !== 'function' || typeof client.get !== 'function') {
    throw new TypeError('Connected SFTP client with list() and get() is required');
  }
  if (issueEnabled !== true) {
    throw fail(
      'VF_LOCAL_AGENT_SFTP_ISSUE_NOT_ENABLED',
      'SFTP ingestion is disabled until issueEnabled=true is explicitly configured',
    );
  }

  const normalizedSourceId = text(sourceId, 'sourceId');
  const remoteDir = normalizeRemoteDirectory(remoteDirectory);
  const maximumBytes = Number(maxFileBytes);
  const minimumAge = Number(minAgeMs);
  const timestamp = Number(now);

  if (!Number.isFinite(maximumBytes) || maximumBytes < 1) {
    throw fail('VF_LOCAL_AGENT_SFTP_LIMIT_INVALID', 'maxFileBytes must be a positive number');
  }
  if (!Number.isFinite(minimumAge) || minimumAge < 0) {
    throw fail('VF_LOCAL_AGENT_SFTP_LIMIT_INVALID', 'minAgeMs must be zero or positive');
  }

  const layout = await ensureWatchFolderLayout(root);
  const entries = await client.list(remoteDir);
  if (!Array.isArray(entries)) {
    throw fail('VF_LOCAL_AGENT_SFTP_PROTOCOL_INVALID', 'SFTP list() must return an array');
  }

  const downloaded = [];
  const skipped = [];

  for (const entry of [...entries].sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')))) {
    const rawType = String(entry?.type ?? '');
    if (rawType && rawType !== '-' && rawType !== 'file') {
      skipped.push({ name: String(entry?.name ?? ''), reason: 'not_regular_file' });
      continue;
    }

    const name = safeRemoteName(entry?.name);
    const extension = extname(name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      skipped.push({ name, reason: 'unsupported_extension' });
      continue;
    }

    const size = Number(entry?.size ?? -1);
    if (!Number.isFinite(size) || size < 0) {
      throw fail('VF_LOCAL_AGENT_SFTP_METADATA_INVALID', 'Remote file size is invalid', { name });
    }
    if (size > maximumBytes) {
      skipped.push({ name, reason: 'file_too_large', size });
      continue;
    }

    const modifiedAt = normalizeModifiedAt(entry?.modifyTime ?? entry?.mtime ?? 0);
    if (minimumAge > 0 && modifiedAt > timestamp - minimumAge) {
      skipped.push({ name, reason: 'not_stable_yet' });
      continue;
    }

    const remotePath = posix.join(remoteDir, name);
    const value = await client.get(remotePath);
    const buffer = Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : null;
    if (!buffer) {
      throw fail('VF_LOCAL_AGENT_SFTP_PROTOCOL_INVALID', 'SFTP get() must return file bytes', { name });
    }
    if (buffer.length !== size) {
      throw fail('VF_LOCAL_AGENT_SFTP_SIZE_MISMATCH', 'Remote file changed during download', {
        name,
        listedSize: size,
        downloadedSize: buffer.length,
      });
    }
    if (buffer.length > maximumBytes) {
      throw fail('VF_LOCAL_AGENT_SFTP_FILE_TOO_LARGE', 'Downloaded file exceeds maxFileBytes', { name });
    }

    const fingerprint = sha256Hex(buffer);
    const sourceKey = sourceKeyFor({
      remoteDirectory: remoteDir,
      name,
      fingerprint,
    });
    const existing = store.getSourceReceipt(normalizedSourceId, sourceKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw fail('VF_LOCAL_AGENT_SOURCE_RECEIPT_CONFLICT', 'SFTP source receipt fingerprint conflict', {
          name,
          sourceKey,
        });
      }
      skipped.push({ name, reason: 'already_received', sourceKey, sha256: fingerprint });
      continue;
    }

    const destination = await localDestination(layout.inbox, name, sourceKey);
    const temp = join(layout.inbox, `.${basename(destination)}.partial-${process.pid}-${Date.now()}`);

    await writeFile(temp, buffer, { mode: 0o600, flag: 'wx' });
    if (process.platform !== 'win32') await chmod(temp, 0o600);
    await rename(temp, destination);
    if (process.platform !== 'win32') await chmod(destination, 0o600);

    try {
      store.recordSourceReceipt({
        sourceId: normalizedSourceId,
        sourceKey,
        fingerprint,
        metadata: {
          channel: 'sftp',
          remoteDirectory: remoteDir,
          remoteName: name,
          size,
          modifiedAt,
          localName: basename(destination),
        },
        now: timestamp,
      });
    } catch (error) {
      await unlink(destination).catch(() => {});
      throw error;
    }

    downloaded.push(Object.freeze({
      name,
      remotePath,
      localName: basename(destination),
      size,
      sha256: fingerprint,
      sourceKey,
    }));
  }

  return Object.freeze({
    sourceId: normalizedSourceId,
    remoteDirectory: remoteDir,
    downloaded: Object.freeze(downloaded),
    skipped: Object.freeze(skipped),
  });
}

export async function syncSftpSource({
  SftpClient,
  connection,
  ...options
} = {}) {
  if (typeof SftpClient !== 'function') throw new TypeError('SftpClient constructor is required');
  const client = new SftpClient();
  await client.connect(createSftpConnectionConfig(connection));
  try {
    return await syncSftpDropFolder({ ...options, client });
  } finally {
    await client.end();
  }
}
