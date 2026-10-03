import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { LocalAgentStore } from '../../packages/local-agent/src/store.mjs';

function arg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const command = process.argv[2];
const dbPath = resolve(arg('--db') || '');
if (!command || !arg('--db')) throw new Error('Usage: fixture <create|inspect> --db PATH [--key KEY]');

if (command === 'create') {
  const key = arg('--key') || 'fixture';
  const store = new LocalAgentStore(dbPath);
  try {
    store.enqueue({
      sourceId: 'upgrade-fixture',
      sourceKey: key,
      payload: {
        kind: 'mapped-source',
        profileId: 'upgrade-fixture-v1',
        source: { key },
      },
    });
    console.log(JSON.stringify({ status: 'ok', command, key, count: store.list().length }));
  } finally {
    store.close();
  }
} else if (command === 'inspect') {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const count = Number(db.prepare('SELECT COUNT(*) AS count FROM local_agent_jobs').get()?.count ?? 0);
    const userVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
    const quick = db.prepare('PRAGMA quick_check').all();
    const ok = quick.every((row) => Object.values(row).every((value) => value === 'ok'));
    console.log(JSON.stringify({ status: ok ? 'ok' : 'invalid', command, count, userVersion, quickCheck: ok }));
    if (!ok) process.exitCode = 1;
  } finally {
    db.close();
  }
} else {
  throw new Error('Unknown fixture command');
}
