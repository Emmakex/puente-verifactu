import { createHash, randomBytes } from 'node:crypto';

const PROFILE_RE = /^int_[a-f0-9]{32}$/;
const PREFIX = 'KFS2.';
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_ENDPOINT = 'https://kairoseth.com/api/fiscal';

function fail(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function normalizeSiteUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? '').trim());
  } catch {
    throw fail('VF_CUSTOMER_ACTIVATION_SITE_INVALID', 'Site URL is invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw fail('VF_CUSTOMER_ACTIVATION_SITE_INVALID', 'Site URL must be an HTTPS origin');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

function parseConnectionKey(value) {
  const key = String(value ?? '').trim();
  if (!key.startsWith(PREFIX)) {
    throw fail('VF_CUSTOMER_ACTIVATION_KEY_INVALID', 'Connection key is invalid');
  }
  const secret = key.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(secret)) {
    throw fail('VF_CUSTOMER_ACTIVATION_KEY_INVALID', 'Connection key is invalid');
  }
  return secret;
}

function digestSecret(secret) {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function activationId() {
  return `act_${randomBytes(16).toString('hex')}`;
}

export class KairosethCustomerActivationService {
  constructor({
    store,
    integrationProfiles,
    clock = () => Date.now(),
    ttlMs = DEFAULT_TTL_MS,
    endpoint = DEFAULT_ENDPOINT,
    environment = 'test',
  } = {}) {
    if (!store) throw new TypeError('store is required');
    for (const method of ['create', 'claim', 'consume', 'fail']) {
      if (typeof store[method] !== 'function') throw new TypeError(`store.${method} must be a function`);
    }
    if (!integrationProfiles || typeof integrationProfiles.get !== 'function' || typeof integrationProfiles.provisionCredential !== 'function') {
      throw new TypeError('integrationProfiles is required');
    }
    if (typeof clock !== 'function') throw new TypeError('clock is required');
    if (!Number.isInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 60 * 60 * 1000) {
      throw new TypeError('ttlMs must be between 1 and 60 minutes');
    }
    this.store = store;
    this.integrationProfiles = integrationProfiles;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.endpoint = String(endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.environment = String(environment ?? 'test').trim().toLowerCase();
  }

  async issue(context, profileId, input = {}) {
    const organizationId = String(context?.organizationId ?? '').trim();
    if (!organizationId) throw fail('VF_CUSTOMER_ACTIVATION_TENANT_REQUIRED', 'Organization context is required', 403);
    const id = String(profileId ?? '').trim();
    if (!PROFILE_RE.test(id)) throw fail('VF_CUSTOMER_ACTIVATION_PROFILE_INVALID', 'Integration profile is invalid');
    const connector = String(input?.connector ?? 'woocommerce').trim().toLowerCase();
    if (connector !== 'woocommerce') throw fail('VF_CUSTOMER_ACTIVATION_CONNECTOR_INVALID', 'Only WooCommerce activation is supported');
    const siteUrl = normalizeSiteUrl(input?.siteUrl);

    const profile = await this.integrationProfiles.get(context, id);
    if (profile?.status !== 'active') {
      throw fail('VF_CUSTOMER_ACTIVATION_PROFILE_NOT_READY', 'Integration profile is not active', 409);
    }
    if (profile?.adapter && String(profile.adapter).toLowerCase() !== 'woocommerce') {
      throw fail('VF_CUSTOMER_ACTIVATION_PROFILE_CONNECTOR_MISMATCH', 'Integration profile is not a WooCommerce profile', 409);
    }

    const secret = randomBytes(32).toString('base64url');
    const now = this.clock();
    const expiresAt = now + this.ttlMs;
    const codeSha256 = digestSecret(secret);
    const record = await this.store.create({
      activationId: activationId(),
      codeSha256,
      organizationId,
      profileId: id,
      connector,
      siteUrl,
      createdAt: now,
      expiresAt,
    });

    return Object.freeze({
      schemaVersion: 2,
      activationId: record.activationId,
      connectionKey: `${PREFIX}${secret}`,
      connectionKeyShownOnce: true,
      siteUrl,
      expiresAt,
    });
  }

  async exchange(input = {}) {
    const secret = parseConnectionKey(input?.connectionKey);
    const codeSha256 = digestSecret(secret);
    const connector = String(input?.connector ?? 'woocommerce').trim().toLowerCase();
    if (connector !== 'woocommerce') throw fail('VF_CUSTOMER_ACTIVATION_CONNECTOR_INVALID', 'Only WooCommerce activation is supported');
    const siteUrl = normalizeSiteUrl(input?.siteUrl);
    const now = this.clock();
    const activation = await this.store.claim({ codeSha256, siteUrl, connector, now });

    let provisioned;
    try {
      provisioned = await this.integrationProfiles.provisionCredential(
        { organizationId: activation.organizationId },
        activation.profileId,
        {},
      );
      const token = String(provisioned?.credential?.token ?? '');
      const credentialId = String(provisioned?.credential?.credentialId ?? '');
      if (!provisioned?.credentialShownOnce || token.length < 32 || !credentialId) {
        throw fail('VF_CUSTOMER_ACTIVATION_CREDENTIAL_INVALID', 'Scoped integration credential was not returned', 500);
      }
      await this.store.consume({ codeSha256, credentialId, now: this.clock() });
      return Object.freeze({
        schemaVersion: 2,
        status: 'connected',
        endpoint: this.endpoint,
        environment: this.environment,
        profileId: activation.profileId,
        credential: Object.freeze({ token, credentialId, shownOnce: true }),
      });
    } catch (error) {
      await this.store.fail({ codeSha256, errorCode: error?.code, now: this.clock() }).catch(() => {});
      throw error;
    }
  }
}

export const CUSTOMER_ACTIVATION_PREFIX = PREFIX;
