const DEFAULT_COLLECTION = 'kairoseth_customer_activations';
const COLLECTION_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;
const PROFILE_RE = /^int_[a-f0-9]{32}$/;
const ACTIVATION_RE = /^act_[a-f0-9]{32}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function fail(code, message, status = 500, cause = null) {
  return Object.assign(new Error(message), {
    code,
    status,
    ...(cause ? { cause } : {}),
  });
}

function assertDatabase(database) {
  if (!database || typeof database.collection !== 'function') {
    throw new TypeError('Kairoseth MongoDB database with collection() is required');
  }
  return database;
}

function requiredString(value, name, pattern = null) {
  const text = String(value ?? '').trim();
  if (!text || (pattern && !pattern.test(text))) throw new TypeError(`${name} is invalid`);
  return text;
}

function publicDocument(doc) {
  if (!doc) return null;
  return Object.freeze({
    activationId: doc.activationId,
    organizationId: doc.organizationId,
    profileId: doc.profileId,
    connector: doc.connector,
    siteUrl: doc.siteUrl,
    status: doc.status,
    expiresAt: new Date(doc.expiresAt).getTime(),
    createdAt: Number(doc.createdAt),
    claimedAt: doc.claimedAt == null ? null : Number(doc.claimedAt),
    consumedAt: doc.consumedAt == null ? null : Number(doc.consumedAt),
    credentialId: doc.credentialId ?? null,
  });
}

export function normalizeMongoCustomerActivationCollectionName(value = DEFAULT_COLLECTION) {
  const name = String(value ?? '').trim();
  if (!COLLECTION_RE.test(name) || name.includes('..')) throw new TypeError('collectionName is invalid');
  return name;
}

export function mongoCustomerActivationIndexes() {
  return Object.freeze([
    Object.freeze({
      key: Object.freeze({ expiresAt: 1 }),
      name: 'customer_activation_expiry_ttl',
      expireAfterSeconds: 0,
    }),
    Object.freeze({
      key: Object.freeze({ organizationId: 1, profileId: 1, createdAt: -1 }),
      name: 'customer_activation_tenant_profile_created',
    }),
  ]);
}

export class MongoKairosethCustomerActivationStore {
  constructor({ database, collectionName = DEFAULT_COLLECTION } = {}) {
    this.database = assertDatabase(database);
    this.collectionName = normalizeMongoCustomerActivationCollectionName(collectionName);
    this.collection = this.database.collection(this.collectionName);
    if (!this.collection || typeof this.collection.findOneAndUpdate !== 'function') {
      throw new TypeError('Kairoseth MongoDB collection interface is invalid');
    }
  }

  indexDefinitions() {
    return mongoCustomerActivationIndexes();
  }

  async create(record) {
    const activationId = requiredString(record?.activationId, 'activationId', ACTIVATION_RE);
    const codeSha256 = requiredString(record?.codeSha256, 'codeSha256', SHA256_RE);
    const profileId = requiredString(record?.profileId, 'profileId', PROFILE_RE);
    const organizationId = requiredString(record?.organizationId, 'organizationId');
    const connector = requiredString(record?.connector, 'connector');
    const siteUrl = requiredString(record?.siteUrl, 'siteUrl');
    const createdAt = Number(record?.createdAt);
    const expiresAt = Number(record?.expiresAt);
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) {
      throw new TypeError('activation timestamps are invalid');
    }

    const doc = {
      _id: codeSha256,
      activationId,
      codeSha256,
      organizationId,
      profileId,
      connector,
      siteUrl,
      status: 'issued',
      expiresAt: new Date(expiresAt),
      createdAt,
      claimedAt: null,
      consumedAt: null,
      credentialId: null,
    };

    try {
      await this.collection.insertOne(doc);
      return publicDocument(doc);
    } catch (error) {
      if (error?.code === 11000) {
        throw fail('VF_CUSTOMER_ACTIVATION_EXISTS', 'Customer activation already exists', 409, error);
      }
      throw fail('VF_CUSTOMER_ACTIVATION_MONGODB_ERROR', 'Customer activation could not be created', 500, error);
    }
  }

  async claim({ codeSha256, siteUrl, connector, now }) {
    const digest = requiredString(codeSha256, 'codeSha256', SHA256_RE);
    const result = await this.collection.findOneAndUpdate(
      {
        _id: digest,
        status: 'issued',
        siteUrl: requiredString(siteUrl, 'siteUrl'),
        connector: requiredString(connector, 'connector'),
        expiresAt: { $gt: new Date(now) },
      },
      { $set: { status: 'claiming', claimedAt: now } },
      { returnDocument: 'after' },
    );
    const doc = result?.value ?? result;
    if (!doc) {
      throw fail(
        'VF_CUSTOMER_ACTIVATION_INVALID',
        'Customer activation is invalid, expired, already used, or belongs to another site',
        409,
      );
    }
    return publicDocument(doc);
  }

  async consume({ codeSha256, credentialId, now }) {
    const result = await this.collection.findOneAndUpdate(
      { _id: requiredString(codeSha256, 'codeSha256', SHA256_RE), status: 'claiming' },
      { $set: { status: 'consumed', credentialId: requiredString(credentialId, 'credentialId'), consumedAt: now } },
      { returnDocument: 'after' },
    );
    const doc = result?.value ?? result;
    if (!doc) throw fail('VF_CUSTOMER_ACTIVATION_STATE_CONFLICT', 'Customer activation state changed', 409);
    return publicDocument(doc);
  }

  async fail({ codeSha256, errorCode, now }) {
    await this.collection.updateOne(
      { _id: requiredString(codeSha256, 'codeSha256', SHA256_RE), status: 'claiming' },
      { $set: { status: 'failed', errorCode: String(errorCode ?? 'VF_CUSTOMER_ACTIVATION_EXCHANGE_FAILED'), updatedAt: now } },
    );
  }
}

export function createMongoKairosethCustomerActivationStore(options) {
  return new MongoKairosethCustomerActivationStore(options);
}
