import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationResolvers, validateIntegrationConfig } from '../src/integration-config.mjs';

function baseConfig() {
  return {
    integrations: [],
    euroConversions: [
      {
        organizationId: 'org-1',
        installationId: 'woo-1',
        sourceCurrency: 'USD',
        rateDate: '2026-09-15',
        eurPerUnit: '0.85',
        rateSource: 'BANCO_DE_ESPANA',
        reference: 'BDE:USD:2026-09-15',
      },
      {
        organizationId: 'org-1',
        installationId: 'woo-1',
        sourceCurrency: 'USD',
        rateDate: '2026-09-15',
        sourceInvoiceId: 'woo:order:900',
        eurPerUnit: '0.85',
        rateSource: 'BANCO_DE_ESPANA',
        reference: 'BDE:USD:2026-09-15:ORDER-900',
        fiscalAmounts: {
          taxBreakdown: [{ baseAmount: '85.00', taxAmount: '17.85' }],
          totals: { baseAmount: '85.00', taxAmount: '17.85', totalAmount: '102.85' },
        },
      },
    ],
  };
}

test('resolver scopes rate by tenant, installation, currency and issue date', () => {
  const resolvers = createIntegrationResolvers(baseConfig());
  const context = { organizationId: 'org-1', installationId: 'woo-1' };
  const generic = resolvers.resolveEuroConversion({
    context,
    intent: { currency: 'USD', issueDate: '2026-09-15', sourceInvoiceId: 'woo:order:901' },
  });
  assert.equal(generic.reference, 'BDE:USD:2026-09-15');

  const specific = resolvers.resolveEuroConversion({
    context,
    intent: { currency: 'USD', issueDate: '2026-09-15', sourceInvoiceId: 'woo:order:900' },
  });
  assert.equal(specific.reference, 'BDE:USD:2026-09-15:ORDER-900');
  assert.equal(specific.fiscalAmounts.totals.totalAmount, '102.85');

  const foreignTenant = resolvers.resolveEuroConversion({
    context: { organizationId: 'org-2', installationId: 'woo-1' },
    intent: { currency: 'USD', issueDate: '2026-09-15', sourceInvoiceId: 'woo:order:900' },
  });
  assert.equal(foreignTenant, null);
});

test('configuration rejects invalid and duplicate rates', () => {
  assert.throws(
    () => validateIntegrationConfig({ integrations: [], euroConversions: [{
      organizationId: 'org-1', installationId: 'woo-1', sourceCurrency: 'EUR', rateDate: '2026-09-15', eurPerUnit: '1', rateSource: 'BDE', reference: 'bad',
    }] }),
    /non-EUR ISO currency/,
  );

  const duplicate = baseConfig();
  duplicate.euroConversions.push({ ...duplicate.euroConversions[0] });
  assert.throws(() => validateIntegrationConfig(duplicate), /duplicate EUR conversion/);
});
