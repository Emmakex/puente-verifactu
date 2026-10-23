import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { KairosethCustomerActivationService } from '../src/customer-activation.mjs';

const profileId = 'int_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async create(record) {
      rows.set(record.codeSha256, { ...record, status: 'issued' });
      return { ...record, status: 'issued' };
    },
    async claim({ codeSha256, siteUrl, connector, now }) {
      const row = rows.get(codeSha256);
      if (!row || row.status !== 'issued' || row.expiresAt <= now || row.siteUrl !== siteUrl || row.connector !== connector) {
        throw Object.assign(new Error('invalid'), { code: 'VF_CUSTOMER_ACTIVATION_INVALID', status: 409 });
      }
      row.status = 'claiming';
      row.claimedAt = now;
      return { ...row };
    },
    async consume({ codeSha256, credentialId, now }) {
      const row = rows.get(codeSha256);
      if (!row || row.status !== 'claiming') throw new Error('state conflict');
      row.status = 'consumed';
      row.credentialId = credentialId;
      row.consumedAt = now;
      return { ...row };
    },
    async fail({ codeSha256, errorCode }) {
      const row = rows.get(codeSha256);
      if (row?.status === 'claiming') {
        row.status = 'failed';
        row.errorCode = errorCode;
      }
    },
  };
}

function integrationProfiles() {
  const calls = [];
  return {
    calls,
    async get(context, id) {
      assert.equal(context.organizationId, 'org-test');
      assert.equal(id, profileId);
      return { profileId: id, status: 'active', adapter: 'woocommerce' };
    },
    async provisionCredential(context, id, input) {
      calls.push({ context, id, input });
      return {
        credentialShownOnce: true,
        credential: {
          credentialId: 'kcred-test',
          token: `kairoseth_data_plane_${'x'.repeat(48)}`,
        },
      };
    },
  };
}

test('KFS2 stores only a digest and exchanges once for a scoped credential', async () => {
  let now = 1_800_000_000_000;
  const store = memoryStore();
  const profiles = integrationProfiles();
  const service = new KairosethCustomerActivationService({
    store,
    integrationProfiles: profiles,
    clock: () => now,
    ttlMs: 5 * 60 * 1000,
    environment: 'test',
  });

  const issued = await service.issue(
    { organizationId: 'org-test' },
    profileId,
    { siteUrl: 'https://shop.example/', connector: 'woocommerce' },
  );
  assert.match(issued.connectionKey, /^KFS2\.[A-Za-z0-9_-]{40,128}$/);
  assert.equal(issued.connectionKeyShownOnce, true);
  assert.equal(issued.siteUrl, 'https://shop.example');

  const secret = issued.connectionKey.slice(5);
  const digest = createHash('sha256').update(secret).digest('hex');
  assert.equal(store.rows.has(digest), true);
  assert.equal(JSON.stringify([...store.rows.values()]).includes(secret), false);

  const exchanged = await service.exchange({
    connectionKey: issued.connectionKey,
    siteUrl: 'https://shop.example/',
    connector: 'woocommerce',
  });
  assert.equal(exchanged.status, 'connected');
  assert.equal(exchanged.environment, 'test');
  assert.equal(exchanged.profileId, profileId);
  assert.match(exchanged.credential.token, /^kairoseth_data_plane_/);
  assert.equal(profiles.calls.length, 1);
  assert.equal(store.rows.get(digest).status, 'consumed');

  await assert.rejects(
    service.exchange({ connectionKey: issued.connectionKey, siteUrl: 'https://shop.example', connector: 'woocommerce' }),
    (error) => error.code === 'VF_CUSTOMER_ACTIVATION_INVALID',
  );
});

test('KFS2 is bound to the intended WooCommerce site and expires', async () => {
  let now = 1_800_000_000_000;
  const store = memoryStore();
  const service = new KairosethCustomerActivationService({
    store,
    integrationProfiles: integrationProfiles(),
    clock: () => now,
    ttlMs: 60_000,
  });
  const issued = await service.issue(
    { organizationId: 'org-test' },
    profileId,
    { siteUrl: 'https://shop.example', connector: 'woocommerce' },
  );

  await assert.rejects(
    service.exchange({ connectionKey: issued.connectionKey, siteUrl: 'https://evil.example', connector: 'woocommerce' }),
    (error) => error.code === 'VF_CUSTOMER_ACTIVATION_INVALID',
  );

  now += 61_000;
  await assert.rejects(
    service.exchange({ connectionKey: issued.connectionKey, siteUrl: 'https://shop.example', connector: 'woocommerce' }),
    (error) => error.code === 'VF_CUSTOMER_ACTIVATION_INVALID',
  );
});
