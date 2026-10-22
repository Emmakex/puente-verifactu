import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWooCommerceConnectionKey,
  issueWooCommerceActivation,
  prepareWooCommerceMapping,
} from '../woocommerce-activation-issuer.mjs';

const profileId = 'int_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

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
    constants: {
      invoiceType: 'F1',
      issuer: { name: 'Empresa Demo TEST', taxId: 'B12345678' },
    },
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

test('prepareWooCommerceMapping binds the Kairoseth IntegrationProfile id and rejects placeholders', () => {
  const prepared = prepareWooCommerceMapping(mapping(), profileId);
  assert.equal(prepared.id, profileId);
  assert.equal(prepared.sourceType, 'native');

  const placeholder = mapping();
  placeholder.constants.issuer.taxId = 'CONFIGURE_SERVER_SIDE';
  assert.throws(
    () => prepareWooCommerceMapping(placeholder, profileId),
    (error) => error.code === 'VF_WOO_ACTIVATION_MAPPING_PLACEHOLDER',
  );
});

test('buildWooCommerceConnectionKey contains only scoped data-plane material', () => {
  const key = buildWooCommerceConnectionKey({ profileId, token: `kairoseth_data_plane_${'x'.repeat(40)}` });
  assert.match(key, /^KFS1\./);
  const payload = JSON.parse(Buffer.from(key.slice(5), 'base64url').toString('utf8'));
  assert.deepEqual(payload, {
    v: 1,
    profileId,
    token: `kairoseth_data_plane_${'x'.repeat(40)}`,
  });
});

test('activation issuer orchestrates onboarding, mapping and scoped credential without exposing admin token', async () => {
  const onboardingProfileId = 'onb_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const calls = [];
  const dataPlaneToken = `kairoseth_data_plane_${'d'.repeat(48)}`;
  const adminToken = `admin_${'a'.repeat(48)}`;

  const fetchImpl = async (url, options) => {
    calls.push({ url, options: structuredClone(options) });
    const path = new URL(url).pathname.replace('/api/fiscal', '');
    if (path === '/v1/control-plane/onboarding/profiles') {
      return jsonResponse(201, { profileId: onboardingProfileId });
    }
    if (path === `/v1/control-plane/onboarding/profiles/${onboardingProfileId}/materialize-integration`) {
      return jsonResponse(201, { integration: { profileId } });
    }
    if (path === `/v1/control-plane/integration-profiles/${profileId}/mapping`) {
      return jsonResponse(200, { profileId, status: 'active' });
    }
    if (path === `/v1/control-plane/integration-profiles/${profileId}/credential`) {
      return jsonResponse(201, {
        credentialShownOnce: true,
        credential: { credentialId: 'kcred-test', token: dataPlaneToken },
      });
    }
    return jsonResponse(404, { error: { code: 'unexpected', message: path } });
  };

  const result = await issueWooCommerceActivation({
    adminToken,
    mappingProfile: mapping(),
    label: 'Tienda cliente TEST',
    locale: 'es',
    fetchImpl,
  });

  assert.equal(result.onboardingProfileId, onboardingProfileId);
  assert.equal(result.integrationProfileId, profileId);
  assert.equal(result.credentialId, 'kcred-test');
  assert.equal(result.endpoint, 'https://kairoseth.com/api/fiscal');
  assert.equal(result.connectionKey.includes(adminToken), false);

  const decoded = JSON.parse(Buffer.from(result.connectionKey.slice(5), 'base64url').toString('utf8'));
  assert.equal(decoded.profileId, profileId);
  assert.equal(decoded.token, dataPlaneToken);

  assert.equal(calls.length, 4);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    label: 'Tienda cliente TEST',
    capabilities: { locale: 'es', nativeConnector: 'woocommerce' },
  });
  assert.equal(JSON.parse(calls[1].options.body) && Object.keys(JSON.parse(calls[1].options.body)).length, 0);
  const mappingBody = JSON.parse(calls[2].options.body);
  assert.equal(mappingBody.mappingProfile.id, profileId);
  assert.deepEqual(JSON.parse(calls[3].options.body), {});
  for (const call of calls) {
    assert.equal(call.options.headers.authorization, `Bearer ${adminToken}`);
    assert.equal(JSON.stringify(call.options.body ?? '').includes(adminToken), false);
  }
});
