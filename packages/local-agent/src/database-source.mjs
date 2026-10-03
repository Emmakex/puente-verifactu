import { sha256, stableStringify } from '../../core/src/idempotency.mjs';

export const DATABASE_DIALECTS = Object.freeze(['postgresql', 'mysql', 'mariadb', 'sqlserver']);

const FORBIDDEN_SQL = /\b(?:INSERT|UPDATE|DELETE|MERGE|UPSERT|REPLACE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|CALL|COPY|VACUUM|ANALYZE|ATTACH|DETACH|PRAGMA)\b/i;
const FORBIDDEN_SELECT = /\b(?:INTO|FOR\s+UPDATE|FOR\s+SHARE|LOCK\s+IN\s+SHARE\s+MODE)\b/i;
const SQL_COMMENT = /(?:--|\/\*|\*\/|(?:^|\s)#)/;

function inputError(message, code = 'VF_LOCAL_AGENT_DB_INPUT_INVALID') {
  return Object.assign(new Error(message), { code, retryable: false });
}

function normalizeText(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw inputError(`${name} is required`);
  return text;
}

function normalizePageSize(value) {
  const pageSize = Number(value ?? 100);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw inputError('pageSize must be an integer between 1 and 1000');
  }
  return pageSize;
}

function jsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value, (_key, item) => (
      typeof item === 'bigint' ? item.toString() : item
    )));
  } catch {
    throw inputError('Database row must be JSON serializable', 'VF_LOCAL_AGENT_DB_ROW_INVALID');
  }
}

function cursorKey(value) {
  return `db:${sha256(stableStringify(value))}`;
}

export function assertReadOnlySelect(query) {
  const original = normalizeText(query, 'query');
  const sql = original.endsWith(';') ? original.slice(0, -1).trim() : original;

  if (!sql || sql.includes(';')) {
    throw inputError('Database source query must contain exactly one statement', 'VF_LOCAL_AGENT_DB_QUERY_UNSAFE');
  }
  if (SQL_COMMENT.test(sql)) {
    throw inputError('SQL comments are not allowed in database source queries', 'VF_LOCAL_AGENT_DB_QUERY_UNSAFE');
  }
  if (!/^SELECT\b/i.test(sql)) {
    throw inputError('Database source query must start with SELECT', 'VF_LOCAL_AGENT_DB_QUERY_UNSAFE');
  }
  if (FORBIDDEN_SQL.test(sql) || FORBIDDEN_SELECT.test(sql)) {
    throw inputError('Database source query contains a write-capable SQL construct', 'VF_LOCAL_AGENT_DB_QUERY_UNSAFE');
  }

  return sql;
}

export function createReadOnlyDatabaseDriver({ dialect, fetchPage, verifyReadOnly } = {}) {
  const normalizedDialect = normalizeText(dialect, 'dialect').toLowerCase();
  if (!DATABASE_DIALECTS.includes(normalizedDialect)) {
    throw inputError(`Unsupported database dialect: ${normalizedDialect}`, 'VF_LOCAL_AGENT_DB_DIALECT_UNSUPPORTED');
  }
  if (typeof fetchPage !== 'function') throw new TypeError('fetchPage must be a function');
  if (typeof verifyReadOnly !== 'function') throw new TypeError('verifyReadOnly must be a function');

  return Object.freeze({
    dialect: normalizedDialect,
    readOnly: true,
    async assertReadOnly() {
      const verified = await verifyReadOnly();
      if (verified !== true) {
        throw Object.assign(new Error('Database credentials/session are not verified read-only'), {
          code: 'VF_LOCAL_AGENT_DB_READ_ONLY_REQUIRED',
          retryable: false,
        });
      }
      return true;
    },
    async fetchPage(context) {
      return fetchPage(context);
    },
  });
}

export async function pollDatabaseSource({
  store,
  driver,
  sourceId,
  profileId,
  cursorField,
  query,
  initialCursor = null,
  pageSize = 100,
  issueEnabled = false,
  now = () => Date.now(),
} = {}) {
  if (!store || typeof store.enqueue !== 'function' || typeof store.getCheckpoint !== 'function') {
    throw new TypeError('Local Agent store is required');
  }
  if (!driver || driver.readOnly !== true || typeof driver.assertReadOnly !== 'function' || typeof driver.fetchPage !== 'function') {
    throw inputError('A verified read-only database driver is required', 'VF_LOCAL_AGENT_DB_READ_ONLY_REQUIRED');
  }
  if (issueEnabled !== true) {
    throw Object.assign(new Error('Database ingestion is disabled until issueEnabled=true'), {
      code: 'VF_LOCAL_AGENT_DB_ISSUE_DISABLED',
      retryable: false,
    });
  }

  const normalizedSourceId = normalizeText(sourceId, 'sourceId');
  const normalizedProfileId = normalizeText(profileId, 'profileId');
  const normalizedCursorField = normalizeText(cursorField, 'cursorField');
  const normalizedQuery = assertReadOnlySelect(query);
  const limit = normalizePageSize(pageSize);

  await driver.assertReadOnly();

  const checkpoint = store.getCheckpoint(normalizedSourceId);
  const previousCursor = checkpoint?.cursor?.value ?? initialCursor;
  const fetched = await driver.fetchPage({
    dialect: driver.dialect,
    query: normalizedQuery,
    cursor: previousCursor,
    limit,
  });

  const rows = Array.isArray(fetched) ? fetched : fetched?.rows;
  if (!Array.isArray(rows)) {
    throw inputError('Database driver must return an array of rows', 'VF_LOCAL_AGENT_DB_DRIVER_INVALID');
  }
  if (rows.length > limit) {
    throw inputError('Database driver returned more rows than pageSize', 'VF_LOCAL_AGENT_DB_DRIVER_INVALID');
  }

  const seen = new Set();
  let lastCursor = previousCursor;
  const jobs = [];

  for (const rawRow of rows) {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
      throw inputError('Database driver returned an invalid row', 'VF_LOCAL_AGENT_DB_ROW_INVALID');
    }

    const row = jsonSafe(rawRow);
    const cursor = row[normalizedCursorField];
    if (cursor === null || cursor === undefined || (typeof cursor === 'string' && cursor.length === 0)) {
      throw inputError(
        `Database row is missing cursor field ${normalizedCursorField}`,
        'VF_LOCAL_AGENT_DB_CURSOR_MISSING',
      );
    }

    const sourceKey = cursorKey(cursor);
    if (seen.has(sourceKey)) {
      throw inputError('Database page contains a duplicate cursor value', 'VF_LOCAL_AGENT_DB_CURSOR_DUPLICATE');
    }
    seen.add(sourceKey);

    jobs.push(store.enqueue({
      sourceId: normalizedSourceId,
      sourceKey,
      payload: {
        kind: 'mapped-source',
        profileId: normalizedProfileId,
        source: row,
      },
      now: now(),
      availableAt: now(),
    }));
    lastCursor = cursor;
  }

  const savedCheckpoint = rows.length > 0
    ? store.setCheckpoint(normalizedSourceId, {
        cursorField: normalizedCursorField,
        value: lastCursor,
      }, now())
    : checkpoint;

  return Object.freeze({
    dialect: driver.dialect,
    sourceId: normalizedSourceId,
    profileId: normalizedProfileId,
    fetched: rows.length,
    queued: jobs.length,
    checkpoint: savedCheckpoint,
    jobs: Object.freeze(jobs),
  });
}
