import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_OPTIONS, capabilitiesForSource, visualRecommendation } from '../src/capabilities.mjs';
import { resolveKairosethIntegrationStrategy } from '../../../packages/kairoseth-control-plane/src/capability-onboarding.mjs';

test('visual onboarding covers the universal customer entry points', () => {
  assert.deepEqual(SOURCE_OPTIONS.map((item) => item.id), [
    'woocommerce', 'prestashop', 'erp_crm_api', 'webhook', 'excel_csv',
    'database', 'sftp', 'local_app', 'manual',
  ]);
});

test('visual choices delegate authority to the server capability resolver', () => {
  const expected = {
    woocommerce: 'native_plugin',
    prestashop: 'native_plugin',
    erp_crm_api: 'rest_api',
    webhook: 'webhook',
    excel_csv: 'file_upload',
    database: 'database_read',
    sftp: 'sftp',
    local_app: 'watch_folder',
    manual: 'manual',
  };
  for (const [sourceId, channel] of Object.entries(expected)) {
    const strategy = resolveKairosethIntegrationStrategy(capabilitiesForSource(sourceId, 'es'));
    assert.equal(strategy.channel, channel, sourceId);
    const recommendation = visualRecommendation(strategy, 'es');
    assert.equal(recommendation.channel, channel);
    assert.equal('certificate' in recommendation, false);
    assert.equal('apiKey' in recommendation, false);
  }
});
