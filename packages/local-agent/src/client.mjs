import { PuenteVerifactuClient } from '../../sdk/src/client.mjs';
import { assertOutboundBaseUrl } from './network.mjs';

export function createLocalAgentApiClient({
  baseUrl,
  apiKey,
  fetchImpl = globalThis.fetch,
  connectorVersion = 'local-agent-v1',
  allowInsecureLocalhost = false,
} = {}) {
  const safeBaseUrl = assertOutboundBaseUrl(baseUrl, { allowInsecureLocalhost });
  return new PuenteVerifactuClient({
    baseUrl: safeBaseUrl,
    apiKey,
    fetchImpl,
    connectorVersion,
  });
}
