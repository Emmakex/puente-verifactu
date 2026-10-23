import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, stdin, stdout, stderr } from 'node:process';
import { MongoClient, ServerApiVersion } from 'mongodb';
import { createMongoKairosethCustomerActivationStore } from '../../packages/kairoseth-control-plane/src/index.mjs';
import { prepareWooCommerceMapping } from './woocommerce-activation-issuer.mjs';

const DEFAULT_BASE_URL = 'https://kairoseth.com/api/fiscal';
const PROFILE_RE = /^int_[a-f0-9]{32}$/;
const ONBOARDING_RE = /^onb_[a-f0-9]{32}$/;
const TTL_MS = 15 * 60 * 1000;

function fail(message, code = 'VF_WOO_ONE_TIME_ACTIVATION_ERROR') {
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

function cleanSiteUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? '').trim());
  } catch {
    throw fail('WooCommerce site URL is invalid', 'VF_WOO_ACTIVATION_SITE_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw fail('WooCommerce site URL must be an HTTPS origin', 'VF_WOO_ACTIVATION_SITE_INVALID');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
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
    const error = fail(
      payload?.error?.message ?? `Kairoseth Fiscal returned HTTP ${response.status}`,
      payload?.error?.code ?? 'VF_WOO_ACTIVATION_HTTP_ERROR',
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function issueWooCommerceOneTimeActivation({
  adminToken,
  mappingProfile,
  siteUrl,
  activationStore,
  label = 'WooCommerce',
  locale = 'es',
  baseUrl = DEFAULT_BASE_URL,
  clock = () => Date.now(),
  fetchImpl = fetch,
} = {}) {
  const token = String(adminToken ?? '').trim();
  if (token.length < 16 || /[\r\n]/.test(token)) {
    throw fail('A control-plane Bearer token is required', 'VF_WOO_ACTIVATION_ADMIN_TOKEN_INVALID');
  }
  if (!activationStore || typeof activationStore.create !== 'function') {
    throw new TypeError('activationStore is required');
  }
  const endpoint = cleanBaseUrl(baseUrl);
  const boundSiteUrl = cleanSiteUrl(siteUrl);
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
    body: { label: safeLabel, capabilities: { locale: safeLocale, nativeConnector: 'woocommerce' } },
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

  await jsonRequest({
    fetchImpl,
    baseUrl: endpoint,
    adminToken: token,
    method: 'PUT',
    path: `/v1/control-plane/integration-profiles/${profileId}/mapping`,
    body: { mappingProfile: prepareWooCommerceMapping(mappingProfile, profileId) },
  });

  const secret = randomBytes(32).toString('base64url');
  const now = clock();
  const codeSha256 = createHash('sha256').update(secret, 'utf8').digest('hex');
  const activationId = `act_${randomBytes(16).toString('hex')}`;
  await activationStore.create({
    activationId,
    codeSha256,
    organizationId: String(created.organizationId ?? materialized?.integration?.organizationId ?? '').trim() || String(materialized?.organizationId ?? '').trim(),
    profileId,
    connector: 'woocommerce',
    siteUrl: boundSiteUrl,
    createdAt: now,
    expiresAt: now + TTL_MS,
  });

  return Object.freeze({
    onboardingProfileId: created.profileId,
    integrationProfileId: profileId,
    activationId,
    endpoint,
    siteUrl: boundSiteUrl,
    expiresAt: now + TTL_MS,
    connectionKey: `KFS2.${secret}`,
    connectionKeyShownOnce: true,
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

function mongoClient(uri) {
  return new MongoClient(uri, {
    appName: 'kairoseth-fiscal-activation-issuer',
    family: 4,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  });
}

async function main() {
  const mappingPath = argument('--mapping');
  const siteUrl = argument('--site-url');
  if (!mappingPath) throw fail('--mapping <private-mapping.json> is required');
  if (!siteUrl) throw fail('--site-url <https://customer.example> is required');
  const uri = String(process.env.MONGODB_URI ?? '').trim();
  if (!uri) throw fail('MONGODB_URI is required', 'VF_WOO_ACTIVATION_MONGODB_REQUIRED');
  const databaseName = String(process.env.MONGODB_DB_NAME ?? 'kairoseth').trim();
  if (databaseName !== 'kairoseth') throw fail('MONGODB_DB_NAME must be kairoseth', 'VF_WOO_ACTIVATION_MONGODB_PROFILE_INVALID');

  const client = mongoClient(uri);
  await client.connect();
  try {
    const activationStore = createMongoKairosethCustomerActivationStore({ database: client.db(databaseName) });
    const result = await issueWooCommerceOneTimeActivation({
      adminToken: await readStdinSecret(),
      mappingProfile: JSON.parse(await readFile(resolve(mappingPath), 'utf8')),
      siteUrl,
      activationStore,
      label: argument('--label', 'WooCommerce'),
      locale: argument('--locale', 'es'),
      baseUrl: argument('--base-url', DEFAULT_BASE_URL),
    });

    stderr.write(`${JSON.stringify({
      status: 'issued',
      scheme: 'KFS2',
      onboardingProfileId: result.onboardingProfileId,
      integrationProfileId: result.integrationProfileId,
      activationId: result.activationId,
      endpoint: result.endpoint,
      siteUrl: result.siteUrl,
      expiresAt: result.expiresAt,
      connectionKeyShownOnce: true,
    })}\n`);
    stdout.write(`${result.connectionKey}\n`);
  } finally {
    await client.close();
  }
}

if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    stderr.write(`${JSON.stringify({ code: error?.code ?? 'VF_WOO_ONE_TIME_ACTIVATION_ERROR', message: error?.message ?? 'Activation failed' })}\n`);
    exit(1);
  });
}
