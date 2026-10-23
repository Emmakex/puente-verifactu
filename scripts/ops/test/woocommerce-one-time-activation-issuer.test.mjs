import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { issueWooCommerceOneTimeActivation } from '../woocommerce-one-time-activation-issuer.mjs';

const profileId = 'int_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const onboardingProfileId = 'onb_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function mapping() {
  return {
    profileVersion: 1,
    id: 'template-id',
    name: 'WooCommerce customer mapping',
    sourceType: 'native',
    locale: 'es-ES',
    fields: {
      source_invoice_id: 'sourceInvoiceId',
      invoice_number: 'number',
      order_date: 'issueDate',
      description: 'description',
      currency: 'currency',
      customer_name: 'recipients.0.name',
      customer_tax_id: 'recipients.0.taxId',
      tax_lines: 'taxBreakdown',
      total_amount: 'totals.totalAmount',
    },
    transforms: {},
    taxLineDefaults: { taxCode: '01', regimeKey: '01', operationClass: 'S1' },
    constants: { invoiceType: 'F1', issuer: { name: 'Empresa Demo TEST', taxId: 'B12345678' } },
    defaults: {},
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return structuredClone(body); },
  };
}

test('KFS2 issuer creates mapping and digest record without provisioning a data-plane bearer', async () => {
  const calls = [];
  const records = [];
  const adminToken = `admin_${'a'.repeat(48)}`;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options: structuredClone(options) });
    const path = new URL(url).pathname.replace('/api/fiscal', '');
    if (path === '/v1/control-plane/onboarding/profiles') {
      return jsonResponse(201, { profileId: onboardingProfileId });
    }
    if (path === `/v1/control-plane/onboarding/profiles/${onboardingProfileId}/materialize-integration`) {
      return jsonResponse(201, {
        integration: { profileId, organizationId: 'org-test', status: 'mapping-required', adapter: 'woocommerce' },
      });
    }
    if (path === `/v1/control-plane/integration-profiles/${profileId}/mapping`) {
      return jsonResponse(200, { profileId, organizationId: 'org-test', status: 'active' });
    }
    return jsonResponse(404, { error: { code: 'unexpected', message: path } });
  };
  const activationStore = {
    async create(record) {
      records.push(structuredClone(record));
      return structuredClone(record);
    },
  };

  const result = await issueWooCommerceOneTimeActivation({
    adminToken,
    mappingProfile: mapping(),
    siteUrl: 'https://shop.example/',
    activationStore,
    label: 'Cliente Woo TEST',
    clock: () => 1_800_000_000_000,
    fetchImpl,
  });

  assert.match(result.connectionKey, /^KFS2\.[A-Za-z0-9_-]{40,128}$/);
  assert.equal(result.connectionKey.includes(adminToken), false);
  assert.equal(result.siteUrl, 'https://shop.example');
  assert.equal(calls.length, 3);
  assert.equal(calls.some((call) => call.url.endsWith('/credential')), false);
  assert.equal(records.length, 1);
  assert.equal(records[0].organizationId, 'org-test');
  assert.equal(records[0].profileId, profileId);
  assert.equal(records[0].siteUrl, 'https://shop.example');

  const secret = result.connectionKey.slice(5);
  assert.equal(records[0].codeSha256, createHash('sha256').update(secret).digest('hex'));
  assert.equal(JSON.stringify(records[0]).includes(secret), false);
  assert.equal(JSON.stringify(records[0]).includes(adminToken), false);
});
