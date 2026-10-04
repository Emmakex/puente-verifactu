import { createHash, randomBytes, randomUUID } from 'node:crypto';

const DEFAULT_COLLECTION = 'kairoseth_fiscal_data_plane_credentials';
const ID_RE = /^[A-Za-z0-9._:-]{1,160}$/;

function requiredId(value, name) {
  const text = String(value ?? '').trim();
  if (!ID_RE.test(text)) throw new TypeError(`${name} is invalid`);
  return text;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function identity(input) {
  return Object.freeze({
    organizationId: requiredId(input?.organizationId, 'organizationId'),
    installationId: requiredId(input?.installationId, 'installationId'),
    sourceSystem: requiredId(input?.sourceSystem, 'sourceSystem'),
    profileId: requiredId(input?.profileId, 'profileId'),
  });
}

function publicContext(doc) {
  if (!doc || doc.revokedAt != null) return null;
  return Object.freeze({
    credentialId: doc.credentialId,
    organizationId: doc.organizationId,
    installationId: doc.installationId,
    sourceSystem: doc.sourceSystem,
    profileId: doc.profileId,
    rateLimitPerMinute: Number(doc.rateLimitPerMinute ?? 240),
    permissions: Object.freeze([]),
  });
}

function token() {
  return `pvdp_${randomBytes(32).toString('base64url')}`;
}

function sameIdentity(doc, expected) {
  return doc
    && doc.organizationId === expected.organizationId
    && doc.installationId === expected.installationId
    && doc.sourceSystem === expected.sourceSystem
    && doc.profileId === expected.profileId;
}

export function mongoFiscalDataPlaneAuthIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ tokenSha256: 1 }),
      name: 'fiscal_data_plane_token_unique',
      unique: true,
    }),
    Object.freeze({
      key: Object.freeze({ organizationId: 1, profileId: 1, revokedAt: 1 }),
      name: 'fiscal_data_plane_tenant_profile',
    }),
    Object.freeze({
      key: Object.freeze({ credentialId: 1 }),
      name: 'fiscal_data_plane_credential_unique',
      unique: true,
    }),
  ]);
}

export class MongoKairosethFiscalAuthProvider {
  constructor({
    database,
    collectionName = DEFAULT_COLLECTION,
    clock = () => Date.now(),
  } = {}) {
    if (!database || typeof database.collection !== 'function') {
      throw new TypeError('Kairoseth MongoDB database is required');
    }
    this.collection = database.collection(collectionName);
    this.clock = clock;
  }

  indexDefinitions() {
    return mongoFiscalDataPlaneAuthIndexes();
  }

  async resolveBearerDigest(digest) {
    const normalized = String(digest ?? '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
    return publicContext(await this.collection.findOne({
      tokenSha256: normalized,
      revokedAt: null,
    }));
  }

  async provisionDataPlaneCredential(input) {
    const expected = identity(input);
    const plaintext = token();
    const credentialId = `vfcred_${randomUUID().replaceAll('-', '')}`;
    const now = this.clock();
    const doc = {
      _id: credentialId,
      credentialId,
      ...expected,
      tokenSha256: sha256(plaintext),
      rateLimitPerMinute: 240,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.collection.insertOne(doc);
    return Object.freeze({
      credentialId,
      token: plaintext,
      ...expected,
    });
  }

  async rotateDataPlaneCredential(input) {
    const expected = identity(input);
    const credentialId = requiredId(input?.credentialId, 'credentialId');
    const existing = await this.collection.findOne({ _id: credentialId });
    if (!sameIdentity(existing, expected) || existing.revokedAt != null) {
      throw Object.assign(new Error('Kairoseth data-plane credential not found'), {
        code: 'VF_KAIROSETH_AUTH_CREDENTIAL_NOT_FOUND',
        status: 404,
      });
    }

    const created = await this.provisionDataPlaneCredential(expected);
    const result = await this.collection.updateOne(
      { _id: credentialId, revokedAt: null },
      { $set: { revokedAt: this.clock(), updatedAt: this.clock() } },
    );
    if (result.matchedCount !== 1) {
      await this.collection.deleteOne({ _id: created.credentialId }).catch(() => {});
      throw Object.assign(new Error('Kairoseth data-plane credential rotation conflicted'), {
        code: 'VF_KAIROSETH_AUTH_ROTATE_CONFLICT',
        status: 409,
      });
    }
    return created;
  }

  async revokeDataPlaneCredential(input) {
    const expected = identity(input);
    const credentialId = requiredId(input?.credentialId, 'credentialId');
    const existing = await this.collection.findOne({ _id: credentialId });
    if (!sameIdentity(existing, expected)) return false;
    const now = this.clock();
    const result = await this.collection.updateOne(
      { _id: credentialId, revokedAt: null },
      { $set: { revokedAt: now, updatedAt: now } },
    );
    return result.matchedCount === 1;
  }
}

export function createMongoKairosethFiscalAuthProvider(options) {
  return new MongoKairosethFiscalAuthProvider(options);
}
