import { createHash, randomUUID } from 'node:crypto';
import { parseImportFile } from '../../../connectors/file-import/src/file-reader.mjs';
import {
  buildMappingProfile,
  suggestMapping,
} from '../../../packages/core/src/mapping-assistant.mjs';
import { stableStringify } from '../../../packages/core/src/idempotency.mjs';
import { setPath } from '../../../packages/core/src/mapping.mjs';
import { preflightRows } from '../../../packages/core/src/preflight.mjs';
import {
  MemoryImportBatchStore,
  MemoryImportSessionStore,
} from './import-session-store.mjs';

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_BATCH_LEASE_MS = 60 * 1000;
const ALLOWED_CONSTANT_PATHS = new Set([
  'series',
  'invoiceType',
  'description',
  'issuer.name',
  'issuer.taxId',
  'currency',
  'taxBreakdown.0.taxCode',
  'taxBreakdown.0.regimeKey',
  'taxBreakdown.0.operationClass',
  'taxBreakdown.0.rate',
]);

function apiError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function requireContext(context) {
  for (const field of ['organizationId', 'installationId', 'sourceSystem']) {
    if (!context?.[field] || typeof context[field] !== 'string') {
      throw apiError('VF_API_AUTH_CONTEXT_INVALID', `Authenticated context is missing ${field}`, 500);
    }
  }
  return context;
}

function safeConfiguration(configuration = {}) {
  const result = {};
  for (const [path, value] of Object.entries(configuration ?? {})) {
    if (!ALLOWED_CONSTANT_PATHS.has(path)) {
      throw apiError(
        'VF_IMPORT_CONFIGURATION_FIELD_INVALID',
        `Unsupported fixed field: ${path}`,
        422,
      );
    }
    if (value !== undefined && value !== null && value !== '') {
      result[path] = String(value).trim();
    }
  }
  return result;
}

function identityConstants(context) {
  return {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: context.organizationId,
    installationId: context.installationId,
    sourceSystem: context.sourceSystem,
  };
}

function addConfiguration(target, configuration) {
  for (const [path, value] of Object.entries(safeConfiguration(configuration))) {
    setPath(target, path, value);
  }
  return target;
}

function publicInspection(session) {
  return {
    importId: session.importId,
    expiresAt: new Date(session.expiresAt).toISOString(),
    file: session.file,
    headers: session.headers,
    sampleRows: session.sampleRows,
    assistant: session.assistant,
  };
}

function deterministicBatchId(importId) {
  return `bat_${createHash('sha256').update(String(importId)).digest('hex').slice(0, 32)}`;
}

function batchFingerprint(batch) {
  return createHash('sha256')
    .update(stableStringify({
      importId: batch.importId,
      organizationId: batch.organizationId,
      installationId: batch.installationId,
      profile: batch.profile,
      rows: batch.rows.map((row) => ({
        row: row.row,
        intent: row.intent,
        idempotencyKey: row.idempotencyKey,
      })),
    }))
    .digest('hex');
}

function sanitizedBatchError(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  return {
    code: String(error?.code ?? 'VF_IMPORT_ROW_ISSUE_FAILED').slice(0, 128),
    status,
    retryable: Boolean(error?.retryable) || status >= 500,
  };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function publicBatch(batch) {
  const statusCounts = {
    pending: 0,
    issued: 0,
    failed: 0,
  };
  for (const row of batch.rows ?? []) {
    if (row.status in statusCounts) statusCounts[row.status] += 1;
  }
  return {
    batchId: batch.batchId,
    importId: batch.importId,
    status: batch.status,
    createdAt: new Date(batch.createdAt).toISOString(),
    updatedAt: new Date(batch.updatedAt).toISOString(),
    file: structuredClone(batch.file),
    summary: {
      rows: batch.rows.length,
      ...statusCounts,
    },
    rows: batch.rows.map((row) => ({
      row: row.row,
      status: row.status,
      recordId: row.recordId ?? null,
      duplicate: Boolean(row.duplicate),
      fiscalStatus: row.fiscalStatus ?? null,
      error: row.error == null ? null : structuredClone(row.error),
      attempts: Number(row.attempts ?? 0),
    })),
  };
}

export class ImportSessionService {
  constructor({
    clock = () => Date.now(),
    ttlMs = DEFAULT_TTL_MS,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    maxSessions = DEFAULT_MAX_SESSIONS,
    batchLeaseMs = DEFAULT_BATCH_LEASE_MS,
    store = new MemoryImportSessionStore(),
    batchStore = new MemoryImportBatchStore(),
  } = {}) {
    if (
      !(ttlMs > 0)
      || !(maxFileBytes > 0)
      || !Number.isInteger(maxSessions)
      || maxSessions < 1
      || !(batchLeaseMs > 0)
    ) {
      throw new TypeError(
        'Import session limits, batch lease and maxSessions must be positive',
      );
    }
    for (const method of ['purgeExpired', 'ensureCapacity', 'put', 'get', 'delete']) {
      if (typeof store?.[method] !== 'function') {
        throw new TypeError(`Import session store must implement ${method}()`);
      }
    }
    for (const method of ['create', 'get', 'acquireLease', 'updateRow', 'releaseLease']) {
      if (typeof batchStore?.[method] !== 'function') {
        throw new TypeError(`Import batch store must implement ${method}()`);
      }
    }
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.maxFileBytes = maxFileBytes;
    this.maxSessions = maxSessions;
    this.batchLeaseMs = batchLeaseMs;
    this.store = store;
    this.batchStore = batchStore;
  }

  async purgeExpired(context = null) {
    await this.store.purgeExpired(this.clock(), context);
  }

  async ensureCapacity(context) {
    await this.store.ensureCapacity(this.maxSessions, this.clock(), context);
  }

  async inspect({
    buffer,
    filename,
    sheet,
    headerRow,
    locale = 'es-ES',
    configuration = {},
    context,
  }) {
    requireContext(context);
    if (!Buffer.isBuffer(buffer)) {
      throw apiError('VF_IMPORT_FILE_REQUIRED', 'Import body must be a file buffer', 400);
    }
    if (buffer.length === 0) {
      throw apiError('VF_IMPORT_FILE_EMPTY', 'Import file is empty', 400);
    }
    if (buffer.length > this.maxFileBytes) {
      throw apiError(
        'VF_IMPORT_FILE_TOO_LARGE',
        `Import file exceeds ${this.maxFileBytes} bytes`,
        413,
      );
    }
    await this.ensureCapacity(context);

    const table = parseImportFile(buffer, { filename, sheet, headerRow });
    const constants = addConfiguration(identityConstants(context), configuration);
    const assistant = suggestMapping(table.headers, {
      sampleRows: table.rows,
      sourceType: table.format,
      locale,
      constants,
    });
    const importId = `imp_${randomUUID().replaceAll('-', '')}`;
    const now = this.clock();
    const session = {
      importId,
      organizationId: context.organizationId,
      installationId: context.installationId,
      sourceSystem: context.sourceSystem,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      rows: table.rows,
      headers: table.headers,
      sampleRows: table.rows.slice(0, Math.min(5, table.rows.length)),
      assistant,
      file: {
        filename: String(filename ?? 'import'),
        format: table.format,
        sheetName: table.sheetName ?? null,
        sheetIndex: table.sheetIndex ?? null,
        sheets: table.sheets ?? null,
        headerRow: table.headerRow ?? 1,
        rows: table.rows.length,
        columns: table.headers.length,
      },
    };
    await this.store.put(session);
    return publicInspection(session);
  }

  async session(importId, context) {
    requireContext(context);
    const session = await this.store.get(importId, context);
    if (
      !session
      || session.organizationId !== context.organizationId
      || session.installationId !== context.installationId
    ) {
      throw apiError('VF_IMPORT_SESSION_NOT_FOUND', 'Import session not found', 404);
    }
    if (session.expiresAt <= this.clock()) {
      await this.store.delete(importId, context);
      throw apiError('VF_IMPORT_SESSION_EXPIRED', 'Import session expired', 410);
    }
    await this.purgeExpired(context);
    return session;
  }

  async preflight(
    importId,
    context,
    { acceptedSources = [], overrides = {}, configuration = {} } = {},
  ) {
    const session = await this.session(importId, context);
    const fixed = safeConfiguration(configuration);
    const profile = buildMappingProfile(session.assistant, {
      acceptedSources,
      overrides,
      constants: fixed,
    });
    profile.id = `import-${importId}`;
    profile.name = `Import ${session.file.filename}`;
    profile.constants = addConfiguration(identityConstants(context), fixed);

    const report = preflightRows(session.rows, profile);
    return {
      importId,
      mode: 'dry-run',
      ok: report.ok,
      summary: report.summary,
      profile,
      rows: report.rows.slice(0, 200).map((row) => ({
        row: row.row,
        status: row.status,
        errors: row.errors,
        warnings: row.warnings,
      })),
      truncated: report.rows.length > 200,
    };
  }

  async prepareBatch(
    importId,
    context,
    { acceptedSources = [], overrides = {}, configuration = {} } = {},
  ) {
    const session = await this.session(importId, context);
    const fixed = safeConfiguration(configuration);
    const profile = buildMappingProfile(session.assistant, {
      acceptedSources,
      overrides,
      constants: fixed,
    });
    profile.id = `import-${importId}`;
    profile.name = `Import ${session.file.filename}`;
    profile.constants = addConfiguration(identityConstants(context), fixed);

    const report = preflightRows(session.rows, profile);
    if (!report.ok) {
      throw apiError(
        'VF_IMPORT_BATCH_PREFLIGHT_FAILED',
        'Batch confirmation requires every row to pass preflight',
        422,
      );
    }
    return {
      importId,
      session,
      profile,
      rows: report.rows.map((row) => ({
        row: row.row,
        intent: structuredClone(row.preview),
        idempotencyKey: `${importId}:row:${row.row}`,
      })),
    };
  }

  async confirmBatch(importId, context, options = {}) {
    requireContext(context);
    const prepared = await this.prepareBatch(importId, context, options);
    const now = this.clock();
    const batch = {
      schemaVersion: 1,
      batchId: deterministicBatchId(importId),
      importId,
      organizationId: context.organizationId,
      installationId: context.installationId,
      sourceSystem: context.sourceSystem,
      status: 'confirmed',
      file: structuredClone(prepared.session.file),
      profile: structuredClone(prepared.profile),
      rows: prepared.rows.map((row) => ({
        row: row.row,
        intent: structuredClone(row.intent),
        idempotencyKey: row.idempotencyKey,
        status: 'pending',
        recordId: null,
        fiscalStatus: null,
        duplicate: false,
        error: null,
        attempts: 0,
        updatedAt: null,
      })),
      createdAt: now,
      updatedAt: now,
    };
    batch.fingerprint = batchFingerprint(batch);
    const stored = await this.batchStore.create(batch);
    return publicBatch(stored);
  }

  async batch(batchId, context) {
    requireContext(context);
    const batch = await this.batchStore.get(batchId, context);
    if (!batch) {
      throw apiError('VF_IMPORT_BATCH_NOT_FOUND', 'Import batch not found', 404);
    }
    return publicBatch(batch);
  }

  async issueBatch(batchId, context, bridge) {
    requireContext(context);
    if (!bridge || typeof bridge.issue !== 'function') {
      throw apiError('VF_IMPORT_ISSUE_BRIDGE_UNAVAILABLE', 'Issue bridge is unavailable', 500);
    }

    const existing = await this.batchStore.get(batchId, context);
    if (!existing) {
      throw apiError('VF_IMPORT_BATCH_NOT_FOUND', 'Import batch not found', 404);
    }
    if (existing.status === 'completed') return publicBatch(existing);

    const now = this.clock();
    const leaseToken = `lease_${randomUUID().replaceAll('-', '')}`;
    const leased = await this.batchStore.acquireLease({
      batchId,
      organizationId: context.organizationId,
      installationId: context.installationId,
      leaseToken,
      now,
      expiresAt: now + this.batchLeaseMs,
    });

    if (!leased) {
      const current = await this.batchStore.get(batchId, context);
      if (current?.status === 'completed') return publicBatch(current);
      throw apiError('VF_IMPORT_BATCH_BUSY', 'Import batch is already being processed', 409);
    }

    let finalStatus = 'partial';
    let released = false;
    try {
      for (const row of leased.rows) {
        const eligible = row.status === 'pending'
          || (row.status === 'failed' && row.error?.retryable === true);
        if (!eligible) continue;

        const attempts = Number(row.attempts ?? 0) + 1;
        try {
          const resource = await bridge.issue(
            structuredClone(row.intent),
            context,
            { idempotencyKey: row.idempotencyKey },
          );
          await this.batchStore.updateRow({
            batchId,
            organizationId: context.organizationId,
            installationId: context.installationId,
            leaseToken,
            row: row.row,
            patch: {
              status: 'issued',
              recordId: resource?.recordId ?? null,
              fiscalStatus: resource?.status ?? null,
              duplicate: Boolean(resource?.duplicate),
              error: null,
              attempts,
            },
            now: this.clock(),
          });
        } catch (error) {
          await this.batchStore.updateRow({
            batchId,
            organizationId: context.organizationId,
            installationId: context.installationId,
            leaseToken,
            row: row.row,
            patch: {
              status: 'failed',
              recordId: null,
              fiscalStatus: null,
              duplicate: false,
              error: sanitizedBatchError(error),
              attempts,
            },
            now: this.clock(),
          });
        }
      }

      const current = await this.batchStore.get(batchId, context);
      finalStatus = current?.rows?.every((row) => row.status === 'issued')
        ? 'completed'
        : 'partial';
      const releasedBatch = await this.batchStore.releaseLease({
        batchId,
        organizationId: context.organizationId,
        installationId: context.installationId,
        leaseToken,
        status: finalStatus,
        now: this.clock(),
      });
      released = true;
      return publicBatch(releasedBatch);
    } finally {
      if (!released) {
        await this.batchStore.releaseLease({
          batchId,
          organizationId: context.organizationId,
          installationId: context.installationId,
          leaseToken,
          status: finalStatus,
          now: this.clock(),
        }).catch(() => {});
      }
    }
  }

  async exportBatch(batchId, context, format = 'json') {
    requireContext(context);
    const batch = await this.batchStore.get(batchId, context);
    if (!batch) {
      throw apiError('VF_IMPORT_BATCH_NOT_FOUND', 'Import batch not found', 404);
    }
    const publicValue = publicBatch(batch);
    if (format === 'json') return publicValue;
    if (format !== 'csv') {
      throw apiError('VF_IMPORT_EXPORT_FORMAT_INVALID', 'Unsupported import export format', 406);
    }

    const header = [
      'row',
      'status',
      'recordId',
      'duplicate',
      'fiscalStatus',
      'errorCode',
      'retryable',
      'attempts',
    ];
    const rows = publicValue.rows.map((row) => [
      row.row,
      row.status,
      row.recordId,
      row.duplicate,
      row.fiscalStatus,
      row.error?.code ?? null,
      row.error?.retryable ?? null,
      row.attempts,
    ].map(csvCell).join(','));
    return [header.join(','), ...rows].join('\n') + '\n';
  }

  async remove(importId, context) {
    await this.session(importId, context);
    await this.store.delete(importId, context);
    return { importId, removed: true };
  }
}
