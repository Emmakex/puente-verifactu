import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createMongoKairosethFiscalAuthProvider,
  mongoFiscalDataPlaneAuthIndexes,
} from '../src/mongodb-fiscal-auth.mjs';

class MemoryCollection {
  constructor() {
    this.docs = new Map();
  }

  async insertOne(doc) {
    if (this.docs.has(doc._id)) {
      throw Object.assign(new Error('duplicate'), { code: 11000 });
    }
    this.docs.set(doc._id, structuredClone(doc));
    return { insertedId: doc._id };
  }

  async findOne(query) {
    if (query._id) return structuredClone(this.docs.get(query._id) ?? null);
    for (const doc of this.docs.values()) {
      if (Object.entries(query).every(([key, value]) => doc[key] === value)) {
        return structuredClone(doc);
      }
    }
    return null;
  }

  async updateOne(query, update) {
    for (const [id, doc] of this.docs.entries()) {
      if (!Object.entries(query).every(([key, value]) => doc[key] === value)) continue;
      this.docs.set(id, { ...doc, ...(update.$set ?? {}) });
      return { matchedCount: 1, modifiedCount: 1 };
    }
    return { matchedCount: 0, modifiedCount: 0 };
  }

  async deleteOne(query) {
    const deleted = this.docs.delete(query._id);
    return { deletedCount: deleted ? 1 : 0 };
  }
}

function fixture() {
  const collection = new MemoryCollection();
  const database = {
    collection(name) {
      assert.equal(name, 'kairoseth_fiscal_data_plane_credentials');
      return collection;
    },
  };
  return { collection, provider: createMongoKairosethFiscalAuthProvider({ database, clock: () => 1000 }) };
}

const identity = {
  organizationId: 'org-a',
  installationId: 'install-a',
  sourceSystem: 'universal-rest',
  profileId: 'int_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

test('Kairoseth fiscal auth stores only bearer digest and resolves tenant context', async () => {
  const { collection, provider } = fixture();
  const issued = await provider.provisionDataPlaneCredential(identity);
  assert.match(issued.token, /^pvdp_/);
  assert.match(issued.credentialId, /^vfcred_/);

  const stored = collection.docs.get(issued.credentialId);
  assert.equal('token' in stored, false);
  assert.equal(
    stored.tokenSha256,
    createHash('sha256').update(issued.token).digest('hex'),
  );

  const resolved = await provider.resolveBearerDigest(stored.tokenSha256);
  assert.equal(resolved.organizationId, identity.organizationId);
  assert.equal(resolved.profileId, identity.profileId);
  assert.deepEqual(resolved.permissions, []);
});

test('Kairoseth fiscal auth rotates and revokes credentials without reviving old token', async () => {
  const { collection, provider } = fixture();
  const first = await provider.provisionDataPlaneCredential(identity);
  const firstDigest = collection.docs.get(first.credentialId).tokenSha256;
  const second = await provider.rotateDataPlaneCredential({
    credentialId: first.credentialId,
    ...identity,
  });
  assert.notEqual(second.token, first.token);
  assert.equal(await provider.resolveBearerDigest(firstDigest), null);

  const secondDigest = collection.docs.get(second.credentialId).tokenSha256;
  assert.ok(await provider.resolveBearerDigest(secondDigest));
  assert.equal(await provider.revokeDataPlaneCredential({
    credentialId: second.credentialId,
    ...identity,
  }), true);
  assert.equal(await provider.resolveBearerDigest(secondDigest), null);
});

test('Kairoseth fiscal auth declares unique token and credential indexes', () => {
  const indexes = mongoFiscalDataPlaneAuthIndexes();
  assert.ok(indexes.some((index) => index.name === 'fiscal_data_plane_token_unique' && index.unique));
  assert.ok(indexes.some((index) => index.name === 'fiscal_data_plane_credential_unique' && index.unique));
});
