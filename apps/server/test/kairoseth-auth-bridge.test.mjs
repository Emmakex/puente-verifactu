import test from 'node:test';
import assert from 'node:assert/strict';
import { KairosethAuthBridge } from '../src/kairoseth-auth-bridge.mjs';

const digest = 'a'.repeat(64);
const profile = {
  profileId: 'int_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  organizationId: 'org-a',
  installationId: 'int-install-a',
  adapter: 'universal-rest',
};

test('Kairoseth Auth bridge normalizes data-plane bearer context without control permissions', async () => {
  const bridge = new KairosethAuthBridge({
    provider: {
      resolveBearerDigest: async (value) => {
        assert.equal(value, digest);
        return {
          credentialId: 'cred-a',
          organizationId: 'org-a',
          installationId: 'int-install-a',
          sourceSystem: 'universal-rest',
          rateLimitPerMinute: 321,
          permissions: [],
        };
      },
    },
  });

  const context = await bridge.resolveBearerDigest(digest);
  assert.equal(context.credentialId, 'cred-a');
  assert.equal(context.organizationId, 'org-a');
  assert.equal(context.installationId, 'int-install-a');
  assert.equal(context.sourceSystem, 'universal-rest');
  assert.equal(context.authType, 'kairoseth-bearer');
  assert.equal(context.credentialKind, 'kairoseth-data-plane');
  assert.equal(context.rateLimitPerMinute, 321);
  assert.deepEqual(context.permissions, []);
});

test('Kairoseth Auth bridge rejects dynamic credentials carrying control-plane permissions', async () => {
  const bridge = new KairosethAuthBridge({
    provider: {
      resolveBearerDigest: async () => ({
        credentialId: 'cred-admin',
        organizationId: 'org-a',
        installationId: 'int-install-a',
        sourceSystem: 'universal-rest',
        permissions: ['agents:manage'],
      }),
    },
  });

  await assert.rejects(
    () => bridge.resolveBearerDigest(digest),
    (error) => error.code === 'VF_KAIROSETH_AUTH_EXTERNAL_PERMISSIONS_FORBIDDEN',
  );
});

test('Kairoseth Auth bridge fails closed when provider returns a different tenant identity', async () => {
  const bridge = new KairosethAuthBridge({
    provider: {
      resolveBearerDigest: async () => null,
      provisionDataPlaneCredential: async () => ({
        credentialId: 'cred-wrong',
        token: 'x'.repeat(40),
        organizationId: 'org-other',
        installationId: 'int-install-a',
        sourceSystem: 'universal-rest',
      }),
    },
  });

  await assert.rejects(
    () => bridge.provision(profile),
    (error) => error.code === 'VF_KAIROSETH_AUTH_IDENTITY_MISMATCH',
  );
});

test('Kairoseth Auth bridge validates rotate and revoke provider availability', async () => {
  const bridge = new KairosethAuthBridge({
    provider: {
      resolveBearerDigest: async () => null,
    },
  });

  await assert.rejects(
    () => bridge.provision(profile),
    (error) => error.code === 'VF_KAIROSETH_AUTH_PROVISION_UNAVAILABLE',
  );
  await assert.rejects(
    () => bridge.rotate(profile, 'cred-a'),
    (error) => error.code === 'VF_KAIROSETH_AUTH_ROTATE_UNAVAILABLE',
  );
  await assert.rejects(
    () => bridge.revoke(profile, 'cred-a'),
    (error) => error.code === 'VF_KAIROSETH_AUTH_REVOKE_UNAVAILABLE',
  );
});
