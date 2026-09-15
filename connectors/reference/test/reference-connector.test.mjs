import test from 'node:test';
import assert from 'node:assert/strict';
import { ReferenceConnector } from '../src/reference-connector.mjs';

test('reference connector delegates mapped preflight/send/status', async () => {
  const calls = [];
  const client = {
    preflightMapped: async (profileId, source) => { calls.push(['preflight', profileId, source]); return { ok: true }; },
    issueMapped: async (profileId, source, options) => { calls.push(['issue', profileId, source, options]); return { recordId: 'fr_demo' }; },
    getFiscalRecord: async (recordId) => { calls.push(['get', recordId]); return { recordId, status: 'fiscalized' }; },
  };
  const connector = new ReferenceConnector({ client, profileId: 'erp-v1', sourceName: 'erp-demo' });
  assert.equal((await connector.preflight({ invoice: 1 })).ok, true);
  assert.equal((await connector.send({ invoice: 1 }, { eventId: 'evt-1' })).recordId, 'fr_demo');
  assert.equal((await connector.status('fr_demo')).status, 'fiscalized');
  assert.deepEqual(calls[1][3], { idempotencyKey: 'erp-demo:evt-1' });
});

test('reference connector requires event id', async () => {
  const connector = new ReferenceConnector({ client: {}, profileId: 'erp-v1' });
  await assert.rejects(() => connector.send({}, {}), /eventId is required/);
});
