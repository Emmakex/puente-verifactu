import { readFileSync } from 'node:fs';

const handler = readFileSync('apps/api/src/handler.mjs', 'utf8');
const service = readFileSync('apps/api/src/service.mjs', 'utf8');
const fxBridge = readFileSync('apps/api/src/fx-bridge.mjs', 'utf8');
const apiReadme = readFileSync('apps/api/README.md', 'utf8');

const createExample = JSON.parse(readFileSync('examples/api-lifecycle/create.json', 'utf8'));
const cancelExample = JSON.parse(readFileSync('examples/api-lifecycle/cancel.json', 'utf8'));
const rectificationExample = JSON.parse(readFileSync('examples/api-lifecycle/rectification.json', 'utf8'));
const webhookExample = JSON.parse(readFileSync('examples/api-lifecycle/webhook-event.json', 'utf8'));

const failures = [];
const expect = (condition, code) => { if (!condition) failures.push({ code }); };

expect(
  handler.includes('/status$') && handler.includes('/cancel$'),
  'API_LIFECYCLE_STATUS_CANCEL_ROUTES_REQUIRED',
);
expect(
  service.includes("keys.length !== 1 || keys[0] !== 'sourceCancellationId'"),
  'API_CANCELLATION_SINGLE_SOURCE_ID_REQUIRED',
);
expect(
  service.includes('fiscal identity is derived server-side'),
  'API_CANCELLATION_SERVER_IDENTITY_REQUIRED',
);
expect(
  service.includes('resource.integrationProfileId !== context.profileId')
    && service.includes('resource.installationId !== context.installationId')
    && service.includes('resource.sourceSystem !== context.sourceSystem'),
  'API_RESOURCE_PROFILE_SCOPE_REQUIRED',
);
expect(
  service.includes('sanitizeDeliveryStatus')
    && service.includes('raw') === false,
  'API_STATUS_SANITIZER_REQUIRED',
);
expect(
  service.includes('integrationProfileId: integrationProfileId ?? null')
    && fxBridge.includes('integrationProfileId: integrationProfileId ?? null'),
  'API_MAPPED_RESOURCE_PROFILE_PERSISTENCE_REQUIRED',
);
expect(
  Object.keys(cancelExample).length === 1
    && typeof cancelExample.sourceCancellationId === 'string',
  'API_CANCEL_EXAMPLE_MUST_ONLY_CONTAIN_SOURCE_CANCELLATION_ID',
);
for (const forbidden of [
  'organizationId',
  'installationId',
  'sourceSystem',
  'issuerTaxId',
  'issueDate',
  'number',
  'series',
  'aeatEnvironment',
]) {
  expect(!(forbidden in cancelExample), `API_CANCEL_EXAMPLE_FORBIDDEN_${forbidden}`);
}
expect(
  /^int_[a-f0-9]{32}$/.test(createExample.profileId)
    && createExample.source
    && typeof createExample.source === 'object',
  'API_CREATE_EXAMPLE_PROFILE_SOURCE_REQUIRED',
);
expect(
  /^int_[a-f0-9]{32}$/.test(rectificationExample.profileId)
    && rectificationExample.source
    && typeof rectificationExample.source === 'object',
  'API_RECTIFICATION_EXAMPLE_PROFILE_SOURCE_REQUIRED',
);
for (const forbidden of ['invoiceType', 'rectification', 'organizationId', 'issuerTaxId', 'aeatEnvironment']) {
  expect(
    !(forbidden in rectificationExample.source),
    `API_RECTIFICATION_EXAMPLE_SERVER_CLASSIFICATION_REQUIRED_${forbidden}`,
  );
}
expect(
  webhookExample.eventId
    && webhookExample.invoice
    && typeof webhookExample.invoice === 'object',
  'API_WEBHOOK_EVENT_EXAMPLE_REQUIRED',
);
expect(
  apiReadme.includes('GET /v1/fiscal-records/{recordId}/status')
    && apiReadme.includes('POST /v1/fiscal-records/{recordId}/cancel'),
  'API_LIFECYCLE_DOCUMENTATION_REQUIRED',
);

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    check: 'api-lifecycle-v1-contract',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'api-lifecycle-v1-contract',
  status_contract: true,
  cancellation_server_identity: true,
  integration_profile_scope: true,
  raw_aeat_delivery_exposure: false,
  examples: ['create', 'status', 'cancel', 'rectification', 'webhook'],
}, null, 2));
