import { extname } from 'node:path';
import { suggestMapping } from '../../../packages/core/src/mapping-assistant.mjs';
import { parseCsv } from './csv.mjs';
import { parseXlsx } from './xlsx.mjs';

function fileError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function detectImportFormat({ filename = '', format, buffer } = {}) {
  if (format) {
    const normalized = String(format).toLowerCase().replace(/^\./, '');
    if (['csv', 'xlsx'].includes(normalized)) return normalized;
    throw fileError('VF_IMPORT_FORMAT_UNSUPPORTED', `Unsupported import format: ${format}`);
  }
  const extension = extname(String(filename)).toLowerCase();
  if (extension === '.csv' || extension === '.tsv') return 'csv';
  if (extension === '.xlsx') return 'xlsx';
  if (extension === '.xls') throw fileError('VF_IMPORT_XLS_LEGACY_UNSUPPORTED', 'Legacy .xls files must be saved as .xlsx or CSV before import');
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2])) return 'xlsx';
  return 'csv';
}

export function parseImportFile(buffer, { filename, format, sheet, headerRow, maxRows } = {}) {
  const resolvedFormat = detectImportFormat({ filename, format, buffer });
  if (resolvedFormat === 'xlsx') return parseXlsx(buffer, { sheet, headerRow, maxRows });
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer ?? '');
  return { format: 'csv', ...parseCsv(text) };
}

export function inspectImportFile(buffer, options = {}) {
  const table = parseImportFile(buffer, options);
  const assistant = suggestMapping(table.headers, {
    sampleRows: table.rows,
    sourceType: table.format,
    locale: options.locale ?? 'es-ES',
    constants: options.constants ?? {},
  });
  return {
    file: {
      format: table.format,
      sheetName: table.sheetName ?? null,
      sheetIndex: table.sheetIndex ?? null,
      sheets: table.sheets ?? null,
      headerRow: table.headerRow ?? 1,
      rows: table.rows.length,
      columns: table.headers.length,
    },
    headers: table.headers,
    sampleRows: table.rows.slice(0, Math.min(5, table.rows.length)),
    assistant,
  };
}
