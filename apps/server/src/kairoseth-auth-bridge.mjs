const ID_RE = /^[A-Za-z0-9._:-]{1,160}$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;

function fail(code, message, status = 500) {
  return Object.assign(new Error(message), { code, status });
}

function requiredId(value, name) {
  const text = String(value ?? '').trim();
  if (!ID_RE.test(text)) {
    throw fail('VF_KAIROSETH_AUTH_PROVIDER_INVALID', `${name} is invalid`, 500);
  }
  return text;
}

function expectedIdentity(profile) {
  return Object.freeze({
    organizationId: requiredId(profile?.organizationId, 'organizationId'),
    installationId: requiredId(profile?.installationId, 'installationId'),
    sourceSystem: requiredId(profile?.adapter, 'sourceSystem'),
    profileId: requiredId(profile?.profileId, 'profileId'),
  });
}

function validateProviderIdentity(result, expected) {
  const actual = {
    organizationId: requiredId(result?.organizationId, 'provider.organizationId'),
    installationId: requiredId(result?.installationId, 'provider.installationId'),
    sourceSystem: requiredId(result?.sourceSystem, 'provider.sourceSystem'),
  };
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) {
      throw fail(
        'VF_KAIROSETH_AUTH_IDENTITY_MISMATCH',
        `Kairoseth Auth returned unexpected ${key}`,
        502,
      );
    }
  }
  return actual;
}

function normalizeCredentialResult(result, expected) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw fail('VF_KAIROSETH_AUTH_PROVIDER_INVALID', 'Kairoseth Auth returned an invalid credential result', 502);
  }
  validateProviderIdentity(result, expected);
  const credentialId = requiredId(result.credentialId, 'provider.credentialId');
  const token = result.token == null ? null : String(result.token);
  if (token != null && token.length < 32) {
    throw fail('VF_KAIROSETH_AUTH_PROVIDER_INVALID', 'Kairoseth Auth returned an invalid bearer token', 502);
  }
  return Object.freeze({
    credentialId,
    token,
    shownOnce: token != null,
    provider: 'kairoseth',
  });
}

function normalizeResolvedContext(result) {
  if (!result) return null;
  if (typeof result !== 'object' || Array.isArray(result)) {
    throw fail('VF_KAIROSETH_AUTH_PROVIDER_INVALID', 'Kairoseth Auth returned an invalid bearer context', 502);
  }
  if (Array.isArray(result.permissions) && result.permissions.length > 0) {
    throw fail(
      'VF_KAIROSETH_AUTH_EXTERNAL_PERMISSIONS_FORBIDDEN',
      'Dynamic Kairoseth data-plane credentials cannot carry control-plane permissions',
      403,
    );
  }
  const rate = result.rateLimitPerMinute == null ? 240 : Number(result.rateLimitPerMinute);
  if (!Number.isInteger(rate) || rate < 1 || rate > 100000) {
    throw fail('VF_KAIROSETH_AUTH_PROVIDER_INVALID', 'provider.rateLimitPerMinute is invalid', 502);
  }
  return Object.freeze({
    credentialId: requiredId(result.credentialId, 'provider.credentialId'),
    organizationId: requiredId(result.organizationId, 'provider.organizationId'),
    installationId: requiredId(result.installationId, 'provider.installationId'),
    sourceSystem: requiredId(result.sourceSystem, 'provider.sourceSystem'),
    profileId: requiredId(result.profileId, 'provider.profileId'),
    authType: 'kairoseth-bearer',
    credentialKind: 'kairoseth-data-plane',
    rateLimitPerMinute: rate,
    permissions: Object.freeze([]),
  });
}

export class KairosethAuthBridge {
  constructor({ provider } = {}) {
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
      throw new TypeError('Kairoseth Auth provider is required');
    }
    if (typeof provider.resolveBearerDigest !== 'function') {
      throw new TypeError('provider.resolveBearerDigest must be a function');
    }
    this.provider = provider;
  }

  async resolveBearerDigest(digest) {
    const value = String(digest ?? '').trim().toLowerCase();
    if (!DIGEST_RE.test(value)) return null;
    return normalizeResolvedContext(await this.provider.resolveBearerDigest(value));
  }

  async provision(profile) {
    if (typeof this.provider.provisionDataPlaneCredential !== 'function') {
      throw fail(
        'VF_KAIROSETH_AUTH_PROVISION_UNAVAILABLE',
        'Kairoseth Auth credential provisioning is unavailable',
        503,
      );
    }
    const expected = expectedIdentity(profile);
    const result = await this.provider.provisionDataPlaneCredential({
      profileId: profile.profileId,
      ...expected,
    });
    return normalizeCredentialResult(result, expected);
  }

  async rotate(profile, credentialId) {
    if (typeof this.provider.rotateDataPlaneCredential !== 'function') {
      throw fail(
        'VF_KAIROSETH_AUTH_ROTATE_UNAVAILABLE',
        'Kairoseth Auth credential rotation is unavailable',
        503,
      );
    }
    const expected = expectedIdentity(profile);
    const result = await this.provider.rotateDataPlaneCredential({
      credentialId: requiredId(credentialId, 'credentialId'),
      profileId: profile.profileId,
      ...expected,
    });
    return normalizeCredentialResult(result, expected);
  }

  async revoke(profile, credentialId) {
    if (typeof this.provider.revokeDataPlaneCredential !== 'function') {
      throw fail(
        'VF_KAIROSETH_AUTH_REVOKE_UNAVAILABLE',
        'Kairoseth Auth credential revocation is unavailable',
        503,
      );
    }
    const expected = expectedIdentity(profile);
    const result = await this.provider.revokeDataPlaneCredential({
      credentialId: requiredId(credentialId, 'credentialId'),
      profileId: profile.profileId,
      ...expected,
    });
    if (result === false) {
      throw fail('VF_KAIROSETH_AUTH_REVOKE_FAILED', 'Kairoseth Auth rejected credential revocation', 502);
    }
    return Object.freeze({
      credentialId,
      provider: 'kairoseth',
      revoked: true,
    });
  }
}

export function createKairosethAuthBridge(provider) {
  if (!provider) return null;
  return new KairosethAuthBridge({ provider });
}
