import { randomUUID } from 'node:crypto';
import { parseImportFile } from '../../../connectors/file-import/src/file-reader.mjs';
import {
  buildMappingProfile,
  suggestMapping,
} from '../../../packages/core/src/mapping-assistant.mjs';
import { setPath } from '../../../packages/core/src/mapping.mjs';
import { preflightRows } from '../../../packages/core/src/preflight.mjs';

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 100;
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
    if (!ALLOWED_CONSTANT_PATHS.has(path)) throw apiError('VF_IMPORT_CONFIGURATION_FIELD_INVALID', `Unsupported fixed field: ${path}`, 422);
    if (value !== undefined && value !== null && value !== '') result[path] = String(value).trim();
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
  for (const [path, value] of Object.entries(safeConfiguration(configuration))) setPath(target, path, value);
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

export class ImportSessionService {
  constructor({
    clock = () => Date.now(),
    ttlMs = DEFAULT_TTL_MS,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    maxSessions = DEFAULT_MAX_SESSIONS,
  } = {}) {
    if (!(ttlMs > 0) || !(maxFileBytes > 0) || !Number.isInteger(maxSessions) || maxSessions < 1) {
      throw new TypeError('Import session limits must be positive and maxSessions must be an integer');
    }
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.maxFileBytes = maxFileBytes;
    this.maxSessions = maxSessions;
    this.sessions = new Map();
  }

  purgeExpired() {
    const now = this.clock();
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
  }

  ensureCapacity() {
    this.purgeExpired();
    while (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
  }

  inspect({ buffer, filename, sheet, headerRow, locale = 'es-ES', configuration = {}, context }) {
    requireContext(context);
    if (!Buffer.isBuffer(buffer)) throw apiError('VF_IMPORT_FILE_REQUIRED', 'Import body must be a file buffer', 400);
    if (buffer.length === 0) throw apiError('VF_IMPORT_FILE_EMPTY', 'Import file is empty', 400);
    if (buffer.length > this.maxFileBytes) throw apiError('VF_IMPORT_FILE_TOO_LARGE', `Import file exceeds ${this.maxFileBytes} bytes`, 413);
    this.ensureCapacity();

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
    this.sessions.set(importId, session);
    return publicInspection(session);
  }

  session(importId, context) {
    requireContext(context);
    const session = this.sessions.get(importId);
    if (!session || session.organizationId !== context.organizationId || session.installationId !== context.installationId) {
      throw apiError('VF_IMPORT_SESSION_NOT_FOUND', 'Import session not found', 404);
    }
    if (session.expiresAt <= this.clock()) {
      this.sessions.delete(importId);
      throw apiError('VF_IMPORT_SESSION_EXPIRED', 'Import session expired', 410);
    }
    this.purgeExpired();
    return session;
  }

  preflight(importId, context, { acceptedSources = [], overrides = {}, configuration = {} } = {}) {
    const session = this.session(importId, context);
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

  remove(importId, context) {
    this.session(importId, context);
    this.sessions.delete(importId);
    return { importId, removed: true };
  }
}
