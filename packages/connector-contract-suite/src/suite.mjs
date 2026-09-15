import { isDeepStrictEqual } from 'node:util';

export const CONNECTOR_CONTRACT_SUITE_VERSION = 1;

const DEFAULT_SOURCE = Object.freeze({
  invoice_number: 'CONTRACT-1',
  invoice_date: '2026-09-15',
  total: '121.00',
});

function clone(value) {
  return structuredClone(value);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function same(left, right) {
  return isDeepStrictEqual(stable(left), stable(right));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function callPayload(call) {
  return call?.source ?? call?.intent ?? null;
}

function connectorError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function createProbeClient() {
  const calls = [];
  const push = (call) => {
    calls.push(clone(call));
    return call;
  };

  return {
    calls,
    client: {
      async preflight(intent) {
        push({ method: 'preflight', intent });
        return { mode: 'dry-run', ok: true, preview: clone(intent) };
      },
      async preflightMapped(profileId, source) {
        push({ method: 'preflightMapped', profileId, source });
        return { mode: 'dry-run', ok: true, profileId, preview: clone(source) };
      },
      async issue(intent, { idempotencyKey } = {}) {
        push({ method: 'issue', intent, idempotencyKey });
        return { recordId: 'fr_contract', status: 'fiscalized', duplicate: false };
      },
      async issueMapped(profileId, source, { idempotencyKey } = {}) {
        push({ method: 'issueMapped', profileId, source, idempotencyKey });
        return { recordId: 'fr_contract', status: 'fiscalized', duplicate: false };
      },
      async getFiscalRecord(recordId) {
        push({ method: 'getFiscalRecord', recordId });
        return { recordId, status: 'fiscalized' };
      },
    },
  };
}

function sensitiveInjection(original, payload) {
  if (!payload || typeof payload !== 'object') return [];
  const forbidden = [
    'organizationId',
    'installationId',
    'certificate',
    'privateKey',
    'pfx',
    'passphrase',
    'aeatEnvironment',
    'permissions',
  ];
  return forbidden.filter((key) => !(key in (original ?? {})) && key in payload);
}

function addCheck(checks, id, ok, details = {}) {
  checks.push({ id, status: ok ? 'pass' : 'fail', ...details });
}

async function capture(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function runConnectorContractSuite({
  createConnector,
  profileId = 'contract-profile-v1',
  sourceName = 'contract-connector',
  sampleSource = DEFAULT_SOURCE,
} = {}) {
  if (typeof createConnector !== 'function') {
    throw connectorError('VF_CONTRACT_FACTORY_REQUIRED', 'createConnector must be a function');
  }

  const checks = [];
  const probe = createProbeClient();
  const connector = await createConnector({
    client: probe.client,
    profileId,
    sourceName,
  });

  const interfaceOk = connector
    && typeof connector.preflight === 'function'
    && typeof connector.send === 'function'
    && typeof connector.status === 'function';
  addCheck(checks, 'connector.interface.v1', interfaceOk, {
    expected: ['preflight(source)', 'send(source, { eventId })', 'status(recordId)'],
  });
  if (!interfaceOk) {
    return {
      suiteVersion: CONNECTOR_CONTRACT_SUITE_VERSION,
      ok: false,
      checks,
    };
  }

  const source = clone(sampleSource);
  const original = clone(sampleSource);

  const preflightBefore = probe.calls.length;
  const preflight = await capture(() => connector.preflight(source));
  const preflightCalls = probe.calls.slice(preflightBefore);
  const preflightTransportCalls = preflightCalls.filter((call) => ['preflight', 'preflightMapped'].includes(call.method));
  const preflightIssueCalls = preflightCalls.filter((call) => ['issue', 'issueMapped'].includes(call.method));
  addCheck(checks, 'connector.preflight.delegates-once', preflight.ok && preflightTransportCalls.length === 1 && preflightIssueCalls.length === 0, {
    actualCalls: preflightCalls.map((call) => call.method),
    error: preflight.ok ? undefined : errorMessage(preflight.error),
  });
  addCheck(checks, 'connector.preflight.no-source-mutation', same(source, original));

  const eventId = 'evt-contract-001';
  const firstBefore = probe.calls.length;
  const firstSend = await capture(() => connector.send(source, { eventId }));
  const firstCalls = probe.calls.slice(firstBefore);
  const firstIssue = firstCalls.find((call) => ['issue', 'issueMapped'].includes(call.method));
  const firstKey = firstIssue?.idempotencyKey;
  addCheck(checks, 'connector.send.delegates-once', firstSend.ok && firstCalls.filter((call) => ['issue', 'issueMapped'].includes(call.method)).length === 1, {
    actualCalls: firstCalls.map((call) => call.method),
    error: firstSend.ok ? undefined : errorMessage(firstSend.error),
  });
  addCheck(checks, 'connector.send.idempotency-key-present', typeof firstKey === 'string' && firstKey.trim().length > 0, {
    received: firstKey ?? null,
  });
  addCheck(checks, 'connector.send.no-source-mutation', same(source, original));

  const repeatBefore = probe.calls.length;
  await capture(() => connector.send(source, { eventId }));
  const repeatIssue = probe.calls.slice(repeatBefore).find((call) => ['issue', 'issueMapped'].includes(call.method));
  addCheck(checks, 'connector.send.idempotency-stable', Boolean(firstKey) && repeatIssue?.idempotencyKey === firstKey, {
    first: firstKey ?? null,
    repeated: repeatIssue?.idempotencyKey ?? null,
  });

  const differentBefore = probe.calls.length;
  await capture(() => connector.send(source, { eventId: 'evt-contract-002' }));
  const differentIssue = probe.calls.slice(differentBefore).find((call) => ['issue', 'issueMapped'].includes(call.method));
  addCheck(checks, 'connector.send.idempotency-distinguishes-events', Boolean(firstKey) && Boolean(differentIssue?.idempotencyKey) && differentIssue.idempotencyKey !== firstKey, {
    first: firstKey ?? null,
    different: differentIssue?.idempotencyKey ?? null,
  });

  const missingBefore = probe.calls.length;
  const missingEvent = await capture(() => connector.send(source, {}));
  const missingCalls = probe.calls.slice(missingBefore).filter((call) => ['issue', 'issueMapped'].includes(call.method));
  addCheck(checks, 'connector.send.requires-event-id', !missingEvent.ok && missingCalls.length === 0, {
    error: missingEvent.ok ? null : errorMessage(missingEvent.error),
    issueCalls: missingCalls.length,
  });

  const statusBefore = probe.calls.length;
  const status = await capture(() => connector.status('fr_contract'));
  const statusCalls = probe.calls.slice(statusBefore);
  const getCall = statusCalls.find((call) => call.method === 'getFiscalRecord');
  addCheck(checks, 'connector.status.delegates-record-id', status.ok && getCall?.recordId === 'fr_contract', {
    received: getCall?.recordId ?? null,
    error: status.ok ? undefined : errorMessage(status.error),
  });

  const payloadCalls = probe.calls
    .filter((call) => ['preflight', 'preflightMapped', 'issue', 'issueMapped'].includes(call.method));
  const injected = [...new Set(payloadCalls.flatMap((call) => sensitiveInjection(original, callPayload(call))))];
  addCheck(checks, 'connector.payload.no-sensitive-authority-injection', injected.length === 0, {
    injected,
  });

  const failed = checks.filter((check) => check.status === 'fail');
  return {
    suiteVersion: CONNECTOR_CONTRACT_SUITE_VERSION,
    ok: failed.length === 0,
    summary: {
      checks: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    checks,
  };
}

export async function assertConnectorContract(options) {
  const report = await runConnectorContractSuite(options);
  if (!report.ok) {
    const failed = report.checks.filter((check) => check.status === 'fail').map((check) => check.id);
    throw connectorError('VF_CONNECTOR_CONTRACT_FAILED', `Connector contract failed: ${failed.join(', ')}`, { report });
  }
  return report;
}
