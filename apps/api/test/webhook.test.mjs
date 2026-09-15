import test from 'node:test';
import assert from 'node:assert/strict';
import { FiscalRecordService } from '../../../packages/core/src/fiscal-record-service.mjs';
import { createApiHandler } from '../src/handler.mjs';
import { UniversalBridgeService } from '../src/service.mjs';
import { signWebhook } from '../src/webhook.mjs';

const sif = { systemId: 'PV', installationNumber: '001', timeZone: 'Europe/Madrid' };
const secret = 'test-webhook-secret';
const profile = {
  profileVersion: 1,
  id: 'generic-json',
  name: 'Generic JSON',
  sourceType: 'webhook',
  fields: {
    invoice_number: 'number',
    invoice_date: 'issueDate',
    total: 'totals.totalAmount',
  },
  transforms: {},
  constants: {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: 'ignored',
    installationId: 'ignored',
    sourceSystem: 'ignored',
    sourceInvoiceId: 'hook-1',
    invoiceType: 'F2',
    description: 'Webhook test',
    issuer: { name: 'Empresa Demo', taxId: 'TESTISSUER' },
    currency: 'EUR',
    taxBreakdown: [{ taxCode: '01', regimeKey: '01', operationClass: 'S1', baseAmount: '100.00', taxAmount: '21.00' }],
    totals: { baseAmount: '100.00', taxAmount: '21.00' },
  },
  defaults: {},
};

function setup() {
  const fiscalService = new FiscalRecordService({ sif, clock: () => new Date('2026-09-15T08:00:00Z') });
  const bridge = new UniversalBridgeService({ fiscalService });
  const handler = createApiHandler({
    bridge,
    authenticate: async () => ({ organizationId: 'org-webhook', installationId: 'hook-installation', sourceSystem: 'generic-webhook' }),
    resolveMappingProfile: async ({ profileId }) => profileId === profile.id ? profile : null,
    resolveWebhookSecret: async () => secret,
  });
  return handler;
}

test('signed webhook maps source data and creates a fiscal record', async () => {
  const handler = setup();
  const rawBody = JSON.stringify({ invoice_number: 'W-1', invoice_date: '2026-09-15', total: '121.00' });
  const timestamp = '1789459200';
  const signature = signWebhook({ rawBody, timestamp, secret });
  const response = await handler({
    method: 'POST',
    path: '/v1/webhooks/generic-json',
    body: rawBody,
    rawBody,
    headers: {
      'x-pv-timestamp': timestamp,
      'x-pv-signature': `sha256=${signature}`,
      'x-event-id': 'hook-event-1',
    },
  });
  assert.equal(response.status, 202);
  assert.equal(response.body.organizationId, 'org-webhook');
});

test('invalid webhook signature is rejected', async () => {
  const handler = setup();
  const rawBody = JSON.stringify({ invoice_number: 'W-1', invoice_date: '2026-09-15', total: '121.00' });
  const response = await handler({
    method: 'POST',
    path: '/v1/webhooks/generic-json',
    body: rawBody,
    rawBody,
    headers: {
      'x-pv-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-pv-signature': `sha256=${'0'.repeat(64)}`,
      'x-event-id': 'hook-event-2',
    },
  });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'VF_WEBHOOK_SIGNATURE_INVALID');
});
