import { ReferenceConnector } from './src/reference-connector.mjs';

export const profileId = 'reference-contract-v1';
export const sourceName = 'reference-connector';
export const sampleSource = Object.freeze({
  invoice_number: 'REF-CONTRACT-1',
  invoice_date: '2026-09-15',
  total: '121.00',
});

export function createConnectorUnderTest({ client, profileId: resolvedProfileId, sourceName: resolvedSourceName }) {
  return new ReferenceConnector({
    client,
    profileId: resolvedProfileId ?? profileId,
    sourceName: resolvedSourceName ?? sourceName,
  });
}
