import test from 'node:test';
import assert from 'node:assert/strict';
import { runConnectorContractSuite } from '../src/suite.mjs';
import { createConnectorUnderTest } from '../../../connectors/reference/contract.mjs';

function safeSync(connector) {
  return async (source, { eventId, recordId } = {}) => {
    if (recordId) return connector.status(recordId);
    if (!eventId) throw new TypeError('eventId required');
    const preflight = await connector.preflight(source);
    if (!preflight?.ok) return { status: 'blocked', preflight };
    return connector.send(source, { eventId });
  };
}

test('reference connector passes third-party contract suite v2', async () => {
  const report = await runConnectorContractSuite({ createConnector: createConnectorUnderTest });
  assert.equal(report.suiteVersion, 2);
  assert.equal(report.ok, true);
  assert.equal(report.summary.failed, 0);
  assert.ok(report.summary.passed >= 18);

  const passed = new Set(report.checks.filter((check) => check.status === 'pass').map((check) => check.id));
  assert.equal(passed.has('connector.sync.existing-record-reconciles-only'), true);
  assert.equal(passed.has('connector.sync.reconcile-failure-never-reissues'), true);
  assert.equal(passed.has('connector.sync.preflight-blocks-issue'), true);
  assert.equal(passed.has('connector.sync.retryable-issue-keeps-idempotency'), true);
});

test('suite catches unstable idempotency and missing event guard', async () => {
  let counter = 0;
  const brokenFactory = ({ client }) => {
    const connector = {
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
    };
    connector.sync = safeSync(connector);
    return connector;
  };

  const report = await runConnectorContractSuite({ createConnector: brokenFactory });
  assert.equal(report.ok, false);
  const failed = new Set(report.checks.filter((check) => check.status === 'fail').map((check) => check.id));
  assert.equal(failed.has('connector.send.idempotency-stable'), true);
  assert.equal(failed.has('connector.send.requires-event-id'), true);
});

test('suite catches authority data injected by a connector', async () => {
  const brokenFactory = ({ client }) => {
    const connector = {
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
    };
    connector.sync = safeSync(connector);
    return connector;
  };

  const report = await runConnectorContractSuite({ createConnector: brokenFactory });
  assert.equal(report.ok, false);
  const authority = report.checks.find((check) => check.id === 'connector.payload.no-sensitive-authority-injection');
  assert.equal(authority.status, 'fail');
  assert.deepEqual(authority.injected, ['organizationId']);
});

test('suite rejects a sync implementation that reissues after status failure', async () => {
  const brokenFactory = ({ client }) => ({
    preflight(source) {
      return client.preflightMapped('broken', source);
    },
    send(source, { eventId } = {}) {
      if (!eventId) throw new TypeError('eventId required');
      return client.issueMapped('broken', source, { idempotencyKey: `broken:${eventId}` });
    },
    status(recordId) {
      return client.getFiscalRecord(recordId);
    },
    async sync(source, { eventId, recordId } = {}) {
      if (recordId) {
        try {
          return await client.getFiscalRecord(recordId);
        } catch {
          return client.issueMapped('broken', source, { idempotencyKey: `broken:${eventId}` });
        }
      }
      if (!eventId) throw new TypeError('eventId required');
      const preflight = await client.preflightMapped('broken', source);
      if (!preflight.ok) return { status: 'blocked' };
      return client.issueMapped('broken', source, { idempotencyKey: `broken:${eventId}` });
    },
  });

  const report = await runConnectorContractSuite({ createConnector: brokenFactory });
  assert.equal(report.ok, false);
  const failed = new Set(report.checks.filter((check) => check.status === 'fail').map((check) => check.id));
  assert.equal(failed.has('connector.sync.reconcile-failure-never-reissues'), true);
});
