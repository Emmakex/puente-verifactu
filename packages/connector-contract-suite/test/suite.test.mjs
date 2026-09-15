import test from 'node:test';
import assert from 'node:assert/strict';
import { runConnectorContractSuite } from '../src/suite.mjs';
import { createConnectorUnderTest } from '../../../connectors/reference/contract.mjs';

test('reference connector passes third-party contract suite', async () => {
  const report = await runConnectorContractSuite({ createConnector: createConnectorUnderTest });
  assert.equal(report.ok, true);
  assert.equal(report.summary.failed, 0);
  assert.ok(report.summary.passed >= 8);
});

test('suite catches unstable idempotency and missing event guard', async () => {
  let counter = 0;
  const brokenFactory = ({ client }) => ({
    preflight(source) {
      return client.preflightMapped('broken', source);
    },
    send(source) {
      counter += 1;
      return client.issueMapped('broken', source, { idempotencyKey: `unstable-${counter}` });
    },
    status(recordId) {
      return client.getFiscalRecord(recordId);
    },
  });

  const report = await runConnectorContractSuite({ createConnector: brokenFactory });
  assert.equal(report.ok, false);
  const failed = new Set(report.checks.filter((check) => check.status === 'fail').map((check) => check.id));
  assert.equal(failed.has('connector.send.idempotency-stable'), true);
  assert.equal(failed.has('connector.send.requires-event-id'), true);
});

test('suite catches authority data injected by a connector', async () => {
  const brokenFactory = ({ client }) => ({
    preflight(source) {
      return client.preflight({ ...source, organizationId: 'client-selected-org' });
    },
    send(source, { eventId } = {}) {
      if (!eventId) throw new TypeError('eventId required');
      return client.issue({ ...source, organizationId: 'client-selected-org' }, { idempotencyKey: eventId });
    },
    status(recordId) {
      return client.getFiscalRecord(recordId);
    },
  });

  const report = await runConnectorContractSuite({ createConnector: brokenFactory });
  assert.equal(report.ok, false);
  const authority = report.checks.find((check) => check.id === 'connector.payload.no-sensitive-authority-injection');
  assert.equal(authority.status, 'fail');
  assert.deepEqual(authority.injected, ['organizationId']);
});
