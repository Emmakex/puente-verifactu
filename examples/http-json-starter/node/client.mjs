import { readFile } from 'node:fs/promises';

function env(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const baseUrl = env('PUENTE_BASE_URL').replace(/\/+$/, '');
const token = env('PUENTE_TOKEN');

async function request(path, { method = 'GET', body = null, idempotencyKey = null } = {}) {
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  };
  if (body !== null) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  const response = await fetch(baseUrl + path, {
    method,
    headers,
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const code = payload?.error?.code ?? 'HTTP_ERROR';
    const message = payload?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`${code}: ${message}`);
  }
  return payload;
}

export const preflight = (payload) => request('/v1/preflight', {
  method: 'POST',
  body: payload,
});

export const issue = (payload, idempotencyKey) => request('/v1/fiscal-records', {
  method: 'POST',
  body: payload,
  idempotencyKey,
});

export const status = (recordId) => request(
  `/v1/fiscal-records/${encodeURIComponent(recordId)}/status`,
);

export const cancel = (recordId, sourceCancellationId, idempotencyKey) => request(
  `/v1/fiscal-records/${encodeURIComponent(recordId)}/cancel`,
  {
    method: 'POST',
    body: { sourceCancellationId },
    idempotencyKey,
  },
);

async function jsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const [command, first, second, third] = process.argv.slice(2);
  let result;
  if (command === 'preflight') {
    result = await preflight(await jsonFile(first));
  } else if (command === 'issue' || command === 'rectify') {
    result = await issue(await jsonFile(first), second);
  } else if (command === 'status') {
    result = await status(first);
  } else if (command === 'cancel') {
    result = await cancel(first, second, third);
  } else {
    throw new Error('Usage: preflight <json> | issue|rectify <json> <idempotency-key> | status <recordId> | cancel <recordId> <sourceCancellationId> <idempotency-key>');
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
