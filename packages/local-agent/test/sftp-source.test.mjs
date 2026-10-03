import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAgentStore } from '../src/store.mjs';
import { ingestWatchFolder } from '../src/watch-ingest.mjs';
import {
  createPinnedSftpHostVerifier,
  createSftpConnectionConfig,
  syncSftpDropFolder,
} from '../src/sftp-source.mjs';

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

test('SFTP host verifier pins SHA-256 in hex or OpenSSH form', () => {
  const hostKey = Buffer.from('test-host-key');
  const digest = createHash('sha256').update(hostKey).digest();
  const hex = digest.toString('hex');
  const openssh = `SHA256:${digest.toString('base64').replace(/=+$/, '')}`;

  assert.equal(createPinnedSftpHostVerifier(hex)(hex), true);
  assert.equal(createPinnedSftpHostVerifier(openssh)(hex), true);
  assert.equal(createPinnedSftpHostVerifier(hex)('0'.repeat(64)), false);

  const config = createSftpConnectionConfig({
    host: 'sftp.example.test',
    username: 'reader',
    password: 'secret',
    hostKeySha256: openssh,
  });
  assert.equal(config.hostHash, 'sha256');
  assert.equal(config.hostVerifier(hex), true);
  assert.equal(config.password, 'secret');
});

test('SFTP ingress is fail-closed until issuance is explicitly enabled', async () => {
  const store = new LocalAgentStore(':memory:');
  let listed = false;
  const client = {
    async list() { listed = true; return []; },
    async get() { throw new Error('must not download'); },
  };

  await assert.rejects(
    () => syncSftpDropFolder({
      store,
      client,
      root: '/tmp/not-used',
      remoteDirectory: '/drop',
    }),
    (error) => error.code === 'VF_LOCAL_AGENT_SFTP_ISSUE_NOT_ENABLED',
  );
  assert.equal(listed, false);
  store.close();
});

test('SFTP ingress downloads stable CSV once and feeds the existing watch-folder pipeline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pv-sftp-'));
  const store = new LocalAgentStore(':memory:');
  const csv = Buffer.from('invoice,total\nF-1,10.50\nF-2,20.75\n');
  let gets = 0;

  const client = {
    async list() {
      return [
        { name: 'ignore.txt', type: '-', size: 3, modifyTime: 1 },
        { name: 'nested', type: 'd', size: 0, modifyTime: 1 },
        { name: 'invoices.csv', type: '-', size: csv.length, modifyTime: 1 },
      ];
    },
    async get(remotePath) {
      gets += 1;
      assert.equal(remotePath, '/drop/invoices.csv');
      return csv;
    },
  };

  try {
    const first = await syncSftpDropFolder({
      store,
      client,
      root,
      remoteDirectory: '/drop',
      sourceId: 'sftp-erp',
      issueEnabled: true,
      minAgeMs: 0,
      now: 10_000,
    });

    assert.equal(first.downloaded.length, 1);
    assert.equal(first.downloaded[0].sha256, sha256Hex(csv));
    assert.equal(gets, 1);

    const inboxFiles = await readdir(join(root, 'inbox'));
    assert.deepEqual(inboxFiles, ['invoices.csv']);
    assert.deepEqual(await readFile(join(root, 'inbox', 'invoices.csv')), csv);

    const second = await syncSftpDropFolder({
      store,
      client,
      root,
      remoteDirectory: '/drop',
      sourceId: 'sftp-erp',
      issueEnabled: true,
      minAgeMs: 0,
      now: 11_000,
    });
    assert.equal(second.downloaded.length, 0);
    assert.equal(second.skipped.some((item) => item.reason === 'already_received'), true);
    assert.equal(gets, 1);

    const ingested = await ingestWatchFolder({
      store,
      root,
      sourceId: 'sftp-erp',
      profileId: 'sftp-profile',
      issueEnabled: true,
      minAgeMs: 0,
      now: 12_000,
    });
    assert.equal(ingested.staged.length, 1);
    assert.equal(store.list().length, 2);
    assert.equal(store.list()[0].payload.kind, 'mapped-source');
    assert.equal(store.list()[0].payload.profileId, 'sftp-profile');
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('SFTP ingress refuses a file that changes size during download and records no receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pv-sftp-size-'));
  const store = new LocalAgentStore(':memory:');
  const client = {
    async list() {
      return [{ name: 'invoices.csv', type: '-', size: 100, modifyTime: 1 }];
    },
    async get() {
      return Buffer.from('short');
    },
  };

  try {
    await assert.rejects(
      () => syncSftpDropFolder({
        store,
        client,
        root,
        remoteDirectory: '/drop',
        sourceId: 'sftp-size',
        issueEnabled: true,
        minAgeMs: 0,
      }),
      (error) => error.code === 'VF_LOCAL_AGENT_SFTP_SIZE_MISMATCH',
    );
    const inboxFiles = await readdir(join(root, 'inbox'));
    assert.deepEqual(inboxFiles, []);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('durable source receipts reject the same source identity with a different fingerprint', () => {
  const store = new LocalAgentStore(':memory:');
  try {
    const first = store.recordSourceReceipt({
      sourceId: 'sftp',
      sourceKey: 'remote-key',
      fingerprint: 'a'.repeat(64),
      metadata: { remoteName: 'a.csv' },
      now: 100,
    });
    assert.equal(first.fingerprint, 'a'.repeat(64));

    assert.throws(
      () => store.recordSourceReceipt({
        sourceId: 'sftp',
        sourceKey: 'remote-key',
        fingerprint: 'b'.repeat(64),
        metadata: { remoteName: 'a.csv' },
        now: 200,
      }),
      (error) => error.code === 'VF_LOCAL_AGENT_SOURCE_RECEIPT_CONFLICT',
    );
  } finally {
    store.close();
  }
});
