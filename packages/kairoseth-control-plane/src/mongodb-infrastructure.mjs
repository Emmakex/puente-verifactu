import {
  mongoAeatOutboxIndexes,
} from './mongodb-aeat-outbox.mjs';
import {
  mongoFiscalDataPlaneAuthIndexes,
} from './mongodb-fiscal-auth.mjs';
import {
  mongoFiscalRecordIndexes,
  mongoIntegrationRecordIndexes,
  mongoIntegrationRequestIndexes,
} from './mongodb-dataplane.mjs';
import {
  mongoImportBatchIndexes,
  mongoImportSessionIndexes,
} from './mongodb-import-batches.mjs';
import {
  mongoIntegrationProfileIndexes,
} from './mongodb-integration-profiles.mjs';
import {
  mongoLocalAgentRegistryIndexes,
} from './mongodb-local-agent-registry.mjs';
import {
  mongoOnboardingProfileIndexes,
} from './mongodb-onboarding-profiles.mjs';

export function kairosethMongoIndexPlan() {
  return Object.freeze([
    Object.freeze({ collection: 'kairoseth_fiscal_records', indexes: mongoFiscalRecordIndexes() }),
    Object.freeze({ collection: 'kairoseth_api_records', indexes: mongoIntegrationRecordIndexes() }),
    Object.freeze({ collection: 'kairoseth_api_requests', indexes: mongoIntegrationRequestIndexes() }),
    Object.freeze({ collection: 'kairoseth_import_sessions', indexes: mongoImportSessionIndexes() }),
    Object.freeze({ collection: 'kairoseth_import_batches', indexes: mongoImportBatchIndexes() }),
    Object.freeze({ collection: 'kairoseth_local_agent_installations', indexes: mongoLocalAgentRegistryIndexes() }),
    Object.freeze({ collection: 'kairoseth_onboarding_profiles', indexes: mongoOnboardingProfileIndexes() }),
    Object.freeze({ collection: 'kairoseth_integration_profiles', indexes: mongoIntegrationProfileIndexes() }),
    Object.freeze({ collection: 'kairoseth_aeat_outbox', indexes: mongoAeatOutboxIndexes() }),
    Object.freeze({ collection: 'kairoseth_fiscal_data_plane_credentials', indexes: mongoFiscalDataPlaneAuthIndexes() }),
  ]);
}

function mongoIndexOptions(definition) {
  return {
    name: definition.name,
    ...(definition.unique ? { unique: true } : {}),
    ...(definition.sparse ? { sparse: true } : {}),
    ...(definition.expireAfterSeconds != null
      ? { expireAfterSeconds: definition.expireAfterSeconds }
      : {}),
    ...(definition.partialFilterExpression
      ? { partialFilterExpression: structuredClone(definition.partialFilterExpression) }
      : {}),
  };
}

export async function applyKairosethMongoIndexes(database) {
  const applied = [];
  for (const item of kairosethMongoIndexPlan()) {
    const collection = database.collection(item.collection);
    for (const definition of item.indexes) {
      await collection.createIndex(
        { ...definition.key },
        mongoIndexOptions(definition),
      );
      applied.push(`${item.collection}:${definition.name}`);
    }
  }
  return Object.freeze(applied);
}

export async function verifyKairosethMongoIndexes(database) {
  const missing = [];
  for (const item of kairosethMongoIndexPlan()) {
    let indexes;
    try {
      indexes = await database.collection(item.collection).indexes();
    } catch {
      indexes = [];
    }
    const names = new Set(indexes.map((index) => index.name));
    for (const definition of item.indexes) {
      if (!names.has(definition.name)) {
        missing.push(`${item.collection}:${definition.name}`);
      }
    }
  }
  if (missing.length) {
    const error = new Error(
      `Kairoseth MongoDB infrastructure is missing required indexes: ${missing.join(', ')}`,
    );
    error.code = 'VF_KAIROSETH_MONGODB_INDEXES_MISSING';
    error.missing = missing;
    throw error;
  }
  return Object.freeze({ ok: true, missing: Object.freeze([]) });
}
