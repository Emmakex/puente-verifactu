import { createHash, randomUUID } from 'node:crypto';
import { parseImportFile } from '../../../connectors/file-import/src/file-reader.mjs';
import {
  buildMappingProfile,
  suggestMapping,
} from '../../../packages/core/src/mapping-assistant.mjs';
import { setPath } from '../../../packages/core/src/mapping.mjs';
import { stableStringify } from '../../../packages/core/src/idempotency.mjs';
import { preflightRows } from '../../../packages/core/src/preflight.mjs';
import { MemoryImportSessionStore } from './import-session-store.mjs';

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_BATCH_LEASE_MS = 2 * 60 * 1000;

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
      throw apiError(
        'VF_API_AUTH_CONTEXT_INVALID',
        `Authenticated context is missing ${field}`,
        500,
      );
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

function batchIdFor(importId) {
  const match = String(importId ?? '').match(/^imp_([a-f0-9]{32})$/);
  if (!match) throw apiError('VF_IMPORT_SESSION_ID_INVALID', 'Import session id is invalid', 400);
  return `bat_${match[1]}`;
}

function preflightFingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function safeRowError(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = String(error?.code ?? 'VF_IMPORT_ROW_ISSUE_FAILED').slice(0, 128);
  return Object.freeze({
    code,
    status,
    retryable: status >= 500 || code === 'VF_AEAT_UNAVAILABLE',
  });
}

function summarizeRows(rows) {
  const issued = rows.filter((row) => row.status === 'issued').length;
  const failed = rows.filter((row) => row.status === 'failed').length;
  const pending = rows.length - issued - failed;
  return Object.freeze({
    rows: rows.length,
    issued,
    failed,
    pending,
  });
}

function publicBatch(batch) {
  if (!batch) return null;
  return Object.freeze({
    schemaVersion: 1,
    batchId: batch.batchId,
    importId: batch.importId,
    organizationId: batch.organizationId,
    installationId: batch.installationId,
    sourceSystem: batch.sourceSystem,
    state: batch.state,
    file: structuredClone(batch.file),
    mappingProfileId: batch.mappingProfile?.id ?? null,
    preflightToken: batch.preflightToken,
    summary: structuredClone(batch.summary ?? summarizeRows(batch.rows ?? [])),
    createdAt: new Date(batch.createdAt).toISOString(),
    updatedAt: new Date(batch.updatedAt).toISOString(),
    rows: Object.freeze((batch.rows ?? []).map((row) => Object.freeze({
      row: row.row,
      sourceInvoiceId: row.intent?.sourceInvoiceId ?? null,
      status: row.status,
      recordId: row.recordId ?? null,
      error: row.error ?? null,
      issuedAt: row.issuedAt == null ? null : new Date(row.issuedAt).toISOString(),
    }))),
  });
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function batchCsv(batch) {
  const lines = [
    ['row', 'sourceInvoiceId', 'status', 'recordId', 'errorCode', 'retryable']
      .map(csvEscape)
      .join(','),
  ];
  for (const row of batch.rows ?? []) {
    lines.push([
      row.row,
      row.intent?.sourceInvoiceId ?? '',
      row.status,
      row.recordId ?? '',
      row.error?.code ?? '',
      row.error?.retryable ?? '',
    ].map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export class ImportSessionService {
  constructor({
    clock = () => Date.now(),
    ttlMs = DEFAULT_TTL_MS,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    maxSessions = DEFAULT_MAX_SESSIONS,
    batchLeaseMs = DEFAULT_BATCH_LEASE_MS,
    store = new MemoryImportSessionStore(),
    batchStore = null,
    bridge = null,
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
    if (batchStore != null) {
      for (const method of ['create', 'get', 'list', 'claim', 'updateRow', 'finalize']) {
        if (typeof batchStore?.[method] !== 'function') {
          throw new TypeError(`Import batch store must implement ${method}()`);
        }
      }
    }
    if (bridge != null && typeof bridge.issue !== 'function') {
      throw new TypeError('bridge.issue must be a function');
    }
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.maxFileBytes = maxFileBytes;
    this.maxSessions = maxSessions;
    this.batchLeaseMs = batchLeaseMs;
    this.store = store;
    this.batchStore = batchStore;
    this.bridge = bridge;
  }

  async purgeExpired() {
    await this.store.purgeExpired(this.clock());
  }

  async ensureCapacity() {
    await this.store.ensureCapacity(this.maxSessions, this.clock());
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
    await this.ensureCapacity();

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
      preflight: null,
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
    const session = await this.store.get(importId);
    if (
      !session
      || session.organizationId !== context.organizationId
      || session.installationId !== context.installationId
    ) {
      throw apiError('VF_IMPORT_SESSION_NOT_FOUND', 'Import session not found', 404);
    }
    if (session.expiresAt <= this.clock()) {
      await this.store.delete(importId);
      throw apiError('VF_IMPORT_SESSION_EXPIRED', 'Import session expired', 410);
    }
    await this.purgeExpired();
    return session;
  }

  buildPreflight(session, context, {
    acceptedSources = [],
    overrides = {},
    configuration = {},
  } = {}) {
    const fixed = safeConfiguration(configuration);
    const profile = buildMappingProfile(session.assistant, {
      acceptedSources,
      overrides,
      constants: fixed,
    });
    profile.id = `import-${session.importId}`;
    profile.name = `Import ${session.file.filename}`;
    profile.constants = addConfiguration(identityConstants(context), fixed);

    const report = preflightRows(session.rows, profile);
    const snapshot = {
      profile,
      summary: report.summary,
      rows: report.rows.map((row) => ({
        row: row.row,
        status: row.status,
        errors: row.errors,
        warnings: row.warnings,
        preview: row.preview ?? null,
      })),
    };
    return {
      report,
      snapshot,
      token: preflightFingerprint(snapshot),
    };
  }

  async preflight(importId, context, options = {}) {
    const session = await this.session(importId, context);
    const { report, snapshot, token } = this.buildPreflight(session, context, options);
    session.preflight = {
      token,
      generatedAt: this.clock(),
      ...snapshot,
    };
    await this.store.put(session);

    return {
      importId,
      mode: 'dry-run',
      ok: report.ok,
      summary: report.summary,
      profile: snapshot.profile,
      preflightToken: token,
      rows: report.rows.slice(0, 200).map((row) => ({
        row: row.row,
        status: row.status,
        errors: row.errors,
        warnings: row.warnings,
      })),
      truncated: report.rows.length > 200,
    };
  }

  requireBatchRuntime() {
    if (!this.batchStore) {
      throw apiError(
        'VF_IMPORT_BATCH_STORE_UNAVAILABLE',
        'Kairoseth durable import batch store is unavailable',
        503,
      );
    }
  }

  async confirm(importId, context, input = {}) {
    this.requireBatchRuntime();
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw apiError('VF_IMPORT_CONFIRM_INPUT_INVALID', 'Confirmation body must be an object', 400);
    }
    const allowed = new Set(['confirm', 'preflightToken']);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        throw apiError(
          'VF_IMPORT_CONFIRM_INPUT_UNKNOWN',
          `Unsupported confirmation field: ${key}`,
          400,
        );
      }
    }
    if (input.confirm !== true) {
      throw apiError(
        'VF_IMPORT_CONFIRM_REQUIRED',
        'Explicit confirm=true is required before fiscalization',
        400,
      );
    }
    const session = await this.session(importId, context);
    const snapshot = session.preflight;
    if (!snapshot?.token) {
      throw apiError(
        'VF_IMPORT_PREFLIGHT_REQUIRED',
        'A successful preflight is required before confirmation',
        409,
      );
    }
    if (String(input.preflightToken ?? '') !== snapshot.token) {
      throw apiError(
        'VF_IMPORT_PREFLIGHT_TOKEN_MISMATCH',
        'The confirmed preflight token does not match the latest preflight',
        409,
      );
    }
    if (snapshot.summary?.invalid !== 0) {
      throw apiError(
        'VF_IMPORT_CONFIRM_PREFLIGHT_FAILED',
        'All import rows must pass preflight before confirmation',
        409,
      );
    }

    const now = this.clock();
    const batch = {
      schemaVersion: 1,
      batchId: batchIdFor(importId),
      importId,
      organizationId: context.organizationId,
      installationId: context.installationId,
      sourceSystem: context.sourceSystem,
      state: 'confirmed',
      preflightToken: snapshot.token,
      mappingProfile: structuredClone(snapshot.profile),
      file: structuredClone(session.file),
      rows: snapshot.rows.map((row) => ({
        row: row.row,
        status: 'pending',
        intent: structuredClone(row.preview),
        recordId: null,
        error: null,
        issuedAt: null,
      })),
      summary: {
        rows: snapshot.rows.length,
        issued: 0,
        failed: 0,
        pending: snapshot.rows.length,
      },
      lease: null,
      createdAt: now,
      updatedAt: now,
    };

    const confirmed = await this.batchStore.create(batch);
    await this.store.delete(importId);
    return publicBatch(confirmed);
  }

  async batch(batchId, context) {
    this.requireBatchRuntime();
    requireContext(context);
    const batch = await this.batchStore.get(
      context.organizationId,
      context.installationId,
      batchId,
    );
    if (!batch) {
      throw apiError('VF_IMPORT_BATCH_NOT_FOUND', 'Import batch not found', 404);
    }
    return batch;
  }

  async listBatches(context, { limit = 50 } = {}) {
    this.requireBatchRuntime();
    requireContext(context);
    const batches = await this.batchStore.list(
      context.organizationId,
      context.installationId,
      limit,
    );
    return Object.freeze(batches.map(publicBatch));
  }

  async issueBatch(batchId, context) {
    this.requireBatchRuntime();
    if (!this.bridge) {
      throw apiError(
        'VF_IMPORT_BATCH_BRIDGE_UNAVAILABLE',
        'Fiscal bridge is unavailable for import batch issue',
        503,
      );
    }
    requireContext(context);
    const owner = `worker_${randomUUID().replaceAll('-', '')}`;
    const now = this.clock();
    const claimed = await this.batchStore.claim({
      organizationId: context.organizationId,
      installationId: context.installationId,
      batchId,
      owner,
      now,
      leaseUntil: now + this.batchLeaseMs,
    });

    if (claimed.state === 'completed') {
      return Object.freeze({
        ...publicBatch(claimed),
        duplicate: true,
      });
    }

    const rows = structuredClone(claimed.rows ?? []);
    for (const row of rows) {
      if (row.status === 'issued') continue;
      try {
        const resource = await this.bridge.issue(row.intent, context, {
          idempotencyKey: `import:${batchId}:row:${row.row}`,
        });
        const patch = {
          status: 'issued',
          recordId: resource.recordId,
          error: null,
          issuedAt: this.clock(),
        };
        Object.assign(row, patch);
        await this.batchStore.updateRow({
          organizationId: context.organizationId,
          installationId: context.installationId,
          batchId,
          row: row.row,
          patch,
          owner,
          now: this.clock(),
        });
      } catch (error) {
        const patch = {
          status: 'failed',
          recordId: null,
          error: safeRowError(error),
          issuedAt: null,
        };
        Object.assign(row, patch);
        await this.batchStore.updateRow({
          organizationId: context.organizationId,
          installationId: context.installationId,
          batchId,
          row: row.row,
          patch,
          owner,
          now: this.clock(),
        });
      }
    }

    const summary = summarizeRows(rows);
    const state = summary.failed === 0 && summary.pending === 0
      ? 'completed'
      : 'partial';
    const finalized = await this.batchStore.finalize({
      organizationId: context.organizationId,
      installationId: context.installationId,
      batchId,
      owner,
      state,
      summary,
      now: this.clock(),
    });
    return Object.freeze({
      ...publicBatch(finalized),
      duplicate: false,
    });
  }

  async exportBatch(batchId, context) {
    const batch = await this.batch(batchId, context);
    const publicValue = publicBatch(batch);
    return Object.freeze({
      batchId,
      filename: `${batchId}-results.csv`,
      contentType: 'text/csv; charset=utf-8',
      csv: batchCsv(batch),
      rows: publicValue.rows,
      summary: publicValue.summary,
    });
  }

  async remove(importId, context) {
    await this.session(importId, context);
    await this.store.delete(importId);
    return { importId, removed: true };
  }
}
