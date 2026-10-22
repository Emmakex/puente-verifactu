import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, stdin, stdout, stderr } from 'node:process';

const DEFAULT_BASE_URL = 'https://kairoseth.com/api/fiscal';
const PROFILE_RE = /^int_[a-f0-9]{32}$/;
const ONBOARDING_RE = /^onb_[a-f0-9]{32}$/;
const PLACEHOLDER_RE = /CONFIGURE(?:_|\s|-)/i;

function fail(message, code = 'VF_WOO_ACTIVATION_ISSUER_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanBaseUrl(value) {
  const text = String(value ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const parsed = new URL(text);
  if (parsed.protocol !== 'https:') throw fail('Kairoseth Fiscal base URL must use HTTPS');
  return parsed.toString().replace(/\/$/, '');
}

function assertNoPlaceholders(value, path = 'mappingProfile') {
  if (typeof value === 'string' && PLACEHOLDER_RE.test(value)) {
    throw fail(`Fiscal mapping contains an unresolved placeholder at ${path}`, 'VF_WOO_ACTIVATION_MAPPING_PLACEHOLDER');
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPlaceholders(item, `${path}.${index}`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) assertNoPlaceholders(nested, `${path}.${key}`);
  }
}

export function prepareWooCommerceMapping(input, profileId) {
  if (!PROFILE_RE.test(String(profileId ?? ''))) {
    throw fail('IntegrationProfile id is invalid', 'VF_WOO_ACTIVATION_PROFILE_INVALID');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw fail('MappingProfile JSON must be an object', 'VF_WOO_ACTIVATION_MAPPING_INVALID');
  }
  const mapping = structuredClone(input);
  mapping.id = profileId;
  if (mapping.sourceType !== 'native') {
    throw fail('WooCommerce MappingProfile.sourceType must be native', 'VF_WOO_ACTIVATION_MAPPING_INVALID');
  }
  assertNoPlaceholders(mapping);
  return mapping;
}

export function buildWooCommerceConnectionKey({ profileId, refundProfileId = null, token }) {
  if (!PROFILE_RE.test(String(profileId ?? ''))) {
    throw fail('IntegrationProfile id is invalid', 'VF_WOO_ACTIVATION_PROFILE_INVALID');
  }
  if (refundProfileId && !PROFILE_RE.test(String(refundProfileId))) {
    throw fail('Refund IntegrationProfile id is invalid', 'VF_WOO_ACTIVATION_PROFILE_INVALID');
  }
  const secret = String(token ?? '').trim();
  if (secret.length < 32 || secret.length > 2048 || /[\r\n]/.test(secret)) {
    throw fail('Scoped data-plane token is invalid', 'VF_WOO_ACTIVATION_TOKEN_INVALID');
  }
  const payload = {
    v: 1,
    profileId,
    ...(refundProfileId ? { refundProfileId } : {}),
    token: secret,
  };
  return `KFS1.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

async function jsonRequest({ fetchImpl, baseUrl, adminToken, method, path, body }) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw fail(`Kairoseth Fiscal returned non-JSON HTTP ${response.status}`, 'VF_WOO_ACTIVATION_RESPONSE_INVALID');
  }
  if (!response.ok) {
    const code = payload?.error?.code ?? 'VF_WOO_ACTIVATION_HTTP_ERROR';
    const message = payload?.error?.message ?? `Kairoseth Fiscal returned HTTP ${response.status}`;
    const error = fail(message, code);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function issueWooCommerceActivation({
  adminToken,
  mappingProfile,
  label = 'WooCommerce',
  locale = 'es',
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
} = {}) {
  const token = String(adminToken ?? '').trim();
  if (token.length < 16 || /[\r\n]/.test(token)) {
    throw fail('A control-plane Bearer token is required', 'VF_WOO_ACTIVATION_ADMIN_TOKEN_INVALID');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const endpoint = cleanBaseUrl(baseUrl);
  const safeLabel = String(label ?? '').trim();
  if (!safeLabel || safeLabel.length > 160) throw fail('label is invalid', 'VF_WOO_ACTIVATION_LABEL_INVALID');
  const safeLocale = String(locale ?? 'es').trim().toLowerCase();
  if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(safeLocale)) throw fail('locale is invalid', 'VF_WOO_ACTIVATION_LOCALE_INVALID');

  const created = await jsonRequest({
    fetchImpl,
    baseUrl: endpoint,
    adminToken: token,
    method: 'POST',
    path: '/v1/control-plane/onboarding/profiles',
    body: {
      label: safeLabel,
      capabilities: { locale: safeLocale, nativeConnector: 'woocommerce' },
    },
  });
  if (!ONBOARDING_RE.test(String(created?.profileId ?? ''))) {
    throw fail('Kairoseth did not return a valid onboarding profile id', 'VF_WOO_ACTIVATION_ONBOARDING_INVALID');
  }

  const materialized = await jsonRequest({
    fetchImpl,
    baseUrl: endpoint,
    adminToken: token,
    method: 'POST',
    path: `/v1/control-plane/onboarding/profiles/${created.profileId}/materialize-integration`,
    body: {},
  });
  const profileId = String(materialized?.integration?.profileId ?? '');
  if (!PROFILE_RE.test(profileId)) {
    throw fail('Kairoseth did not return a valid IntegrationProfile id', 'VF_WOO_ACTIVATION_PROFILE_INVALID');
  }

  const mapping = prepareWooCommerceMapping(mappingProfile, profileId);
  await jsonRequest({
    fetchImpl,
    baseUrl: endpoint,
    adminToken: token,
    method: 'PUT',
    path: `/v1/control-plane/integration-profiles/${profileId}/mapping`,
    body: { mappingProfile: mapping },
  });

  const provisioned = await jsonRequest({
    fetchImpl,
    baseUrl: endpoint,
    adminToken: token,
    method: 'POST',
    path: `/v1/control-plane/integration-profiles/${profileId}/credential`,
    body: {},
  });
  const dataPlaneToken = String(provisioned?.credential?.token ?? '');
  if (!provisioned?.credentialShownOnce || !dataPlaneToken) {
    throw fail('Kairoseth did not return the one-time data-plane credential', 'VF_WOO_ACTIVATION_CREDENTIAL_INVALID');
  }

  return Object.freeze({
    onboardingProfileId: created.profileId,
    integrationProfileId: profileId,
    credentialId: provisioned?.credential?.credentialId ?? null,
    connectionKey: buildWooCommerceConnectionKey({ profileId, token: dataPlaneToken }),
    endpoint,
  });
}

function argument(name, fallback = '') {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] ?? '').trim() : fallback;
}

async function readStdinSecret() {
  if (stdin.isTTY) throw fail('Read the control-plane token from stdin; never pass it as a process argument');
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const mappingPath = argument('--mapping');
  if (!mappingPath) throw fail('--mapping <private-mapping.json> is required');
  const mappingProfile = JSON.parse(await readFile(resolve(mappingPath), 'utf8'));
  const result = await issueWooCommerceActivation({
    adminToken: await readStdinSecret(),
    mappingProfile,
    label: argument('--label', 'WooCommerce'),
    locale: argument('--locale', 'es'),
    baseUrl: argument('--base-url', DEFAULT_BASE_URL),
  });

  stderr.write(`${JSON.stringify({
    status: 'issued',
    onboardingProfileId: result.onboardingProfileId,
    integrationProfileId: result.integrationProfileId,
    credentialId: result.credentialId,
    endpoint: result.endpoint,
    connectionKeyShownOnce: true,
  })}\n`);
  stdout.write(`${result.connectionKey}\n`);
}

if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    stderr.write(`${JSON.stringify({ code: error?.code ?? 'VF_WOO_ACTIVATION_ISSUER_ERROR', message: error?.message ?? 'Activation failed' })}\n`);
    exit(1);
  });
}
