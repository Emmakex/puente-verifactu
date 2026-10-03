import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import SftpClient from 'ssh2-sftp-client';
import { LocalAgentStore } from '../../packages/local-agent/src/store.mjs';
import { ingestWatchFolder } from '../../packages/local-agent/src/watch-ingest.mjs';
import {
  createSftpConnectionConfig,
  syncSftpSource,
} from '../../packages/local-agent/src/sftp-source.mjs';

const port = Number(process.env.SFTP_PORT ?? 2222);
const hostKeySha256 = process.env.SFTP_HOST_KEY_SHA256;
if (!hostKeySha256) throw new Error('SFTP_HOST_KEY_SHA256 is required');

const connection = {
  host: '127.0.0.1',
  port,
  username: 'pvreader',
  password: 'ReadOnly!2026',
  hostKeySha256,
  serverHostKeyAlgorithms: ['ssh-ed25519'],
};

const root = await mkdtemp(join(tmpdir(), 'pv-sftp-runtime-'));
const store = new LocalAgentStore(':memory:');

try {
  const first = await syncSftpSource({
    SftpClient,
    connection,
    store,
    root,
    remoteDirectory: '/drop',
    sourceId: 'sftp-runtime',
    issueEnabled: true,
    minAgeMs: 0,
  });
  assert.equal(first.downloaded.length, 1);
  assert.equal(first.downloaded[0].name, 'invoices.csv');

  const second = await syncSftpSource({
    SftpClient,
    connection,
    store,
    root,
    remoteDirectory: '/drop',
    sourceId: 'sftp-runtime',
    issueEnabled: true,
    minAgeMs: 0,
  });
  assert.equal(second.downloaded.length, 0);
  assert.equal(second.skipped.some((item) => item.reason === 'already_received'), true);

  const ingested = await ingestWatchFolder({
    store,
    root,
    sourceId: 'sftp-runtime',
    profileId: 'sftp-runtime-profile',
    issueEnabled: true,
    minAgeMs: 0,
  });
  assert.equal(ingested.staged.length, 1);
  assert.equal(store.list().length, 2);

  const client = new SftpClient();
  await client.connect(createSftpConnectionConfig(connection));
  try {
    await assert.rejects(
      () => client.put(Buffer.from('must fail'), '/drop/write-test.txt'),
    );
  } finally {
    await client.end();
  }

  console.log(JSON.stringify({
    schema_version: 1,
    status: 'ok',
    check: 'local-agent-sftp-runtime',
    host_key_pinned: true,
    remote_source_read_only: true,
    non_destructive_download: true,
    durable_receipt: true,
    watch_folder_handoff: true,
    rows_queued: store.list().length,
  }, null, 2));
} finally {
  store.close();
  await rm(root, { recursive: true, force: true });
}
