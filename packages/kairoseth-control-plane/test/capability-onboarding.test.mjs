import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NATIVE_CONNECTORS,
  resolveKairosethIntegrationStrategy,
} from '../src/capability-onboarding.mjs';

const CASES = [
  [{ nativeConnector: 'woocommerce' }, 'native_plugin', 'web', false, null],
  [{ hasApi: true }, 'rest_api', 'api', false, null],
  [{ canWebhook: true }, 'webhook', 'api', false, null],
  [{ canUploadFiles: true }, 'file_upload', 'web', false, null],
  [{ canReadDatabase: true }, 'database_read', 'connect', true, 'database'],
  [{ canSftp: true }, 'sftp', 'connect', true, 'sftp'],
  [{ canWatchFolder: true }, 'watch_folder', 'connect', true, 'watch-folder'],
  [{ isLocalApplication: true }, 'watch_folder', 'connect', true, 'watch-folder'],
  [{}, 'manual', 'web', false, null],
];

test('capability-first resolver covers every supported Kairoseth ingress family', () => {
  for (const [input, channel, family, localAgent, sourceKind] of CASES) {
    const result = resolveKairosethIntegrationStrategy(input);
    assert.equal(result.channel, channel);
    assert.equal(result.commercialFamily, family);
    assert.equal(result.requiresLocalAgent, localAgent);
    assert.equal(result.sourceKind, sourceKind);
    assert.equal(result.mapping, 'server-side');
    assert.equal(result.fiscalAuthority, 'kairoseth');
    assert.equal(result.tenantAuthority, 'kairoseth');
    assert.equal(result.certificateCustody, 'kairoseth');
    assert.equal(result.autoIssue, false);
    assert.equal(result.autoProvision, false);
    assert.equal(result.returnsSecrets, false);
    assert.ok(result.copy.es.title);
    assert.ok(result.copy.en.title);
    assert.ok(result.nextSteps.length >= 2);
  }
});

test('resolver remains capability-first when a named native connector is unsupported', () => {
  const result = resolveKairosethIntegrationStrategy({
    nativeConnector: 'other-shop',
    hasApi: true,
  });
  assert.equal(result.channel, 'rest_api');
  assert.deepEqual(result.warnings, ['native_connector_not_supported']);
});

test('supported native connectors come from an explicit Kairoseth allowlist', () => {
  assert.deepEqual([...DEFAULT_NATIVE_CONNECTORS].sort(), ['prestashop', 'woocommerce']);
  const result = resolveKairosethIntegrationStrategy(
    { nativeConnector: 'custom-plugin' },
    { supportedNativeConnectors: ['custom-plugin'] },
  );
  assert.equal(result.channel, 'native_plugin');
  assert.equal(result.adapter, 'custom-plugin');
});

test('resolver rejects tenant, fiscal authority, secrets and unknown fields', () => {
  for (const field of [
    'organizationId',
    'installationId',
    'certificate',
    'privateKey',
    'aeatEnvironment',
    'taxRules',
    'apiKey',
    'password',
  ]) {
    assert.throws(
      () => resolveKairosethIntegrationStrategy({ [field]: 'forbidden' }),
      (error) => error.code === 'VF_ONBOARDING_AUTHORITY_FIELD_FORBIDDEN',
    );
  }

  assert.throws(
    () => resolveKairosethIntegrationStrategy({ brand: 'acme' }),
    (error) => error.code === 'VF_ONBOARDING_CAPABILITY_UNKNOWN',
  );
});

test('resolver validates all capability values before applying priority', () => {
  assert.throws(
    () => resolveKairosethIntegrationStrategy({
      hasApi: true,
      canWebhook: 'yes',
    }),
    (error) => error.code === 'VF_ONBOARDING_CAPABILITY_INVALID',
  );
});

test('resolver supports Spanish and English locale selection only', () => {
  assert.equal(resolveKairosethIntegrationStrategy({ locale: 'es-ES' }).locale, 'es');
  assert.equal(resolveKairosethIntegrationStrategy({ locale: 'en-US' }).locale, 'en');
  assert.throws(
    () => resolveKairosethIntegrationStrategy({ locale: 'fr' }),
    (error) => error.code === 'VF_ONBOARDING_LOCALE_UNSUPPORTED',
  );
});
