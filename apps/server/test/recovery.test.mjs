import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBearerToken } from '../src/auth.mjs';
import { createPuenteRuntime } from '../src/runtime.mjs';
import { createSqlitePersistence } from '../../../packages/sqlite-store/src/index.mjs';

test('single-node startup releases orphaned pending HTTP reservations after a crash', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'puente-runtime-recovery-'));
  const databasePath = join(directory, 'puente.sqlite');
  try {
    const persistence = createSqlitePersistence({ path: databasePath });
    const payload = { sourceInvoiceId: 'CRASH-1', total: '121.00' };
    const pending = persistence.integrationStore.reserve('org\u001finstall\u001fevent-crash', payload);
    assert.equal(pending.duplicate, false);
    persistence.close();

    const runtime = createPuenteRuntime({
      databasePath,
      authConfig: {
        credentials: [{
          id: 'recovery-api',
          type: 'bearer',
          tokenSha256: hashBearerToken('recovery-token'),
          organizationId: 'org',
          installationId: 'install',
          sourceSystem: 'test',
          rateLimitPerMinute: 10,
        }],
      },
      sif: { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' },
    });
    try {
      assert.equal(runtime.recoveredReservations, 1);
      const retry = runtime.persistence.integrationStore.reserve('org\u001finstall\u001fevent-crash', payload);
      assert.equal(retry.duplicate, false);
    } finally {
      await runtime.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
