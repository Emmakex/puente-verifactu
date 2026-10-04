import { MongoClient, ServerApiVersion } from 'mongodb';
import { applyKairosethMongoIndexes } from '../../packages/kairoseth-control-plane/src/index.mjs';

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

const uri = required(process.env.MONGODB_URI, 'MONGODB_URI');
const databaseName = String(process.env.MONGODB_DB_NAME ?? 'kairoseth').trim();
if (databaseName !== 'kairoseth') {
  throw new Error('Kairoseth Fiscal production infrastructure must use MONGODB_DB_NAME=kairoseth');
}

const client = new MongoClient(uri, {
  appName: 'kairoseth-fiscal',
  family: 4,
  connectTimeoutMS: 10_000,
  serverSelectionTimeoutMS: 10_000,
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

try {
  await client.connect();
  const applied = await applyKairosethMongoIndexes(client.db(databaseName));
  console.log(JSON.stringify({
    schema_version: 1,
    status: 'ok',
    operation: 'kairoseth-fiscal-mongodb-init',
    database: databaseName,
    indexes: applied.length,
  }, null, 2));
} finally {
  await client.close();
}
