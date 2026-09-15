import { inflateRawSync } from 'node:zlib';
import { posix } from 'node:path';

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const MAX_ENTRIES = 512;
const MAX_TOTAL_UNCOMPRESSED = 25 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED = 10 * 1024 * 1024;
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function xlsxError(code, message) {
  return Object.assign(new Error(message), { code });
}

function assertBounds(buffer, offset, bytes) {
  if (offset < 0 || bytes < 0 || offset + bytes > buffer.length) {
    throw xlsxError('VF_XLSX_CORRUPT', 'XLSX ZIP structure is truncated or corrupt');
  }
}

function findEocd(buffer) {
  const lowerBound = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD) return offset;
  }
  throw xlsxError('VF_XLSX_ZIP_EOCD_MISSING', 'XLSX ZIP end-of-central-directory record was not found');
}

function normalizeEntryName(name) {
  const normalized = posix.normalize(String(name).replaceAll('\\', '/')).replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('../') || normalized.includes('/../') || normalized.startsWith('/')) {
    throw xlsxError('VF_XLSX_ZIP_PATH_INVALID', `Unsafe XLSX ZIP entry path: ${name}`);
  }
  return normalized;
}

function extractZipEntries(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  if (buffer.length < 22) throw xlsxError('VF_XLSX_INVALID', 'XLSX file is too small to be a ZIP workbook');
  const eocd = findEocd(buffer);
  assertBounds(buffer, eocd, 22);
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw xlsxError('VF_XLSX_ZIP_MULTIDISK_UNSUPPORTED', 'Multi-disk XLSX ZIP files are not supported');
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw xlsxError('VF_XLSX_ZIP64_UNSUPPORTED', 'ZIP64 XLSX files are not supported by the lightweight reader');
  }
  if (entryCount > MAX_ENTRIES) throw xlsxError('VF_XLSX_LIMIT_ENTRIES', `XLSX contains too many ZIP entries (${entryCount})`);
  assertBounds(buffer, centralOffset, centralSize);

  const entries = new Map();
  let offset = centralOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    assertBounds(buffer, offset, 46);
    if (buffer.readUInt32LE(offset) !== ZIP_CENTRAL) throw xlsxError('VF_XLSX_ZIP_CENTRAL_INVALID', 'Invalid ZIP central directory entry');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    assertBounds(buffer, offset + 46, fileNameLength + extraLength + commentLength);
    const name = normalizeEntryName(buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8'));

    if ((flags & 0x1) !== 0) throw xlsxError('VF_XLSX_ENCRYPTED_UNSUPPORTED', 'Encrypted XLSX workbooks are not supported');
    if (![0, 8].includes(method)) throw xlsxError('VF_XLSX_COMPRESSION_UNSUPPORTED', `Unsupported XLSX ZIP compression method ${method}`);
    if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED) throw xlsxError('VF_XLSX_LIMIT_ENTRY_SIZE', `XLSX entry ${name} is too large`);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) throw xlsxError('VF_XLSX_LIMIT_TOTAL_SIZE', 'XLSX expands beyond the safe workbook size limit');

    assertBounds(buffer, localOffset, 30);
    if (buffer.readUInt32LE(localOffset) !== ZIP_LOCAL) throw xlsxError('VF_XLSX_ZIP_LOCAL_INVALID', `Invalid local ZIP header for ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    assertBounds(buffer, dataOffset, compressedSize);
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_UNCOMPRESSED });
    if (data.length !== uncompressedSize) throw xlsxError('VF_XLSX_ZIP_SIZE_MISMATCH', `Unexpected uncompressed size for ${name}`);
    entries.set(name, data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function rejectUnsafeXml(xml) {
  const source = String(xml ?? '');
  if (/<!DOCTYPE/i.test(source) || /<!ENTITY/i.test(source)) {
    throw xlsxError('VF_XLSX_XML_UNSAFE', 'DTD and ENTITY declarations are not allowed in XLSX XML');
  }
  return source;
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function attributes(fragment) {
  const result = {};
  const regex = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of String(fragment ?? '').matchAll(regex)) result[match[1]] = decodeXml(match[2] ?? match[3] ?? '');
  return result;
}

function textNodes(xml) {
  const safe = rejectUnsafeXml(xml);
  return [...safe.matchAll(/<(?:[A-Za-z_][\w.-]*:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t\s*>/gi)]
    .map((match) => decodeXml(match[1]))
    .join('');
}

function parseSharedStrings(entries) {
  const data = entries.get('xl/sharedStrings.xml');
  if (!data) return [];
  const xml = rejectUnsafeXml(data.toString('utf8'));
  return [...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si\s*>/gi)]
    .map((match) => textNodes(match[1]));
}

function looksLikeDateFormat(format) {
  const stripped = String(format ?? '')
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*]/g, '')
    .toLowerCase();
  return /(^|[^a-z])[dmy]+([^a-z]|$)/.test(stripped) || /(^|[^a-z])[hs]+([^a-z]|$)/.test(stripped);
}

function parseDateStyles(entries) {
  const data = entries.get('xl/styles.xml');
  if (!data) return new Set();
  const xml = rejectUnsafeXml(data.toString('utf8'));
  const formats = new Map();
  for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?numFmt\b([^>]*)\/?\s*>/gi)) {
    const attr = attributes(match[1]);
    if (attr.numFmtId != null) formats.set(Number(attr.numFmtId), attr.formatCode ?? '');
  }
  const xfsBlock = xml.match(/<(?:[A-Za-z_][\w.-]*:)?cellXfs(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?cellXfs\s*>/i)?.[1] ?? '';
  const dateStyles = new Set();
  let styleIndex = 0;
  for (const match of xfsBlock.matchAll(/<(?:[A-Za-z_][\w.-]*:)?xf\b([^>]*)\/?\s*>/gi)) {
    const attr = attributes(match[1]);
    const numFmtId = Number(attr.numFmtId ?? 0);
    if (BUILTIN_DATE_FORMATS.has(numFmtId) || looksLikeDateFormat(formats.get(numFmtId))) dateStyles.add(styleIndex);
    styleIndex += 1;
  }
  return dateStyles;
}

function excelSerialToIso(value, date1904) {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return String(value ?? '');
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.floor(serial) * 86400000);
  return Number.isNaN(date.getTime()) ? String(value ?? '') : date.toISOString().slice(0, 10);
}

function columnIndex(reference) {
  const letters = String(reference ?? '').match(/^([A-Z]+)/i)?.[1]?.toUpperCase();
  if (!letters) return null;
  let index = 0;
  for (const char of letters) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

function resolveWorkbook(entries) {
  const workbookBuffer = entries.get('xl/workbook.xml');
  const relsBuffer = entries.get('xl/_rels/workbook.xml.rels');
  if (!workbookBuffer || !relsBuffer) throw xlsxError('VF_XLSX_WORKBOOK_MISSING', 'XLSX workbook metadata is incomplete');
  const workbook = rejectUnsafeXml(workbookBuffer.toString('utf8'));
  const rels = rejectUnsafeXml(relsBuffer.toString('utf8'));
  const relationTargets = new Map();
  for (const match of rels.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/?\s*>/gi)) {
    const attr = attributes(match[1]);
    if (attr.Id && attr.Target) relationTargets.set(attr.Id, attr.Target);
  }
  const sheets = [];
  for (const match of workbook.matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*)\/?\s*>/gi)) {
    const attr = attributes(match[1]);
    const relId = attr['r:id'] ?? attr.id;
    const target = relationTargets.get(relId);
    if (!target) continue;
    const path = target.startsWith('/') ? normalizeEntryName(target.slice(1)) : normalizeEntryName(posix.join('xl', target));
    sheets.push({ name: attr.name ?? `Sheet${sheets.length + 1}`, state: attr.state ?? 'visible', path });
  }
  if (sheets.length === 0) throw xlsxError('VF_XLSX_SHEETS_MISSING', 'XLSX workbook contains no readable worksheets');
  const date1904 = /<(?:[A-Za-z_][\w.-]*:)?workbookPr\b([^>]*)\/?\s*>/i.exec(workbook);
  const workbookPr = date1904 ? attributes(date1904[1]) : {};
  return { sheets, date1904: ['1', 'true'].includes(String(workbookPr.date1904 ?? '').toLowerCase()) };
}

function cellValue(inner, attr, sharedStrings, dateStyles, date1904) {
  const type = attr.t ?? '';
  if (type === 'inlineStr') return textNodes(inner);
  const raw = decodeXml(inner.match(/<(?:[A-Za-z_][\w.-]*:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v\s*>/i)?.[1] ?? '');
  if (type === 's') return sharedStrings[Number(raw)] ?? '';
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  if (type === 'str' || type === 'e' || type === 'd') return raw;
  const style = Number(attr.s ?? -1);
  if (raw !== '' && dateStyles.has(style)) return excelSerialToIso(raw, date1904);
  return raw;
}

function parseWorksheet(xmlInput, { sharedStrings, dateStyles, date1904, maxRows = 10000 } = {}) {
  const xml = rejectUnsafeXml(xmlInput);
  const rows = [];
  for (const rowMatch of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?row\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row\s*>/gi)) {
    if (rows.length >= maxRows + 20) throw xlsxError('VF_XLSX_LIMIT_ROWS', `Worksheet exceeds safe row limit ${maxRows}`);
    const values = [];
    const rowXml = rowMatch[1];
    const cellRegex = /<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*?)(?:>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c\s*>|\/\s*>)/gi;
    let sequentialIndex = 0;
    for (const cellMatch of rowXml.matchAll(cellRegex)) {
      const attr = attributes(cellMatch[1]);
      const index = columnIndex(attr.r) ?? sequentialIndex;
      if (index > 255) throw xlsxError('VF_XLSX_LIMIT_COLUMNS', 'Worksheet exceeds safe column limit 256');
      values[index] = cellValue(cellMatch[2] ?? '', attr, sharedStrings, dateStyles, date1904);
      sequentialIndex = index + 1;
    }
    rows.push(values);
  }
  return rows;
}

function selectSheet(sheets, selector) {
  if (selector == null || selector === '') return sheets.find((sheet) => sheet.state === 'visible') ?? sheets[0];
  if (typeof selector === 'number' || /^\d+$/.test(String(selector))) {
    const index = Number(selector);
    return sheets[index] ?? null;
  }
  return sheets.find((sheet) => sheet.name === selector) ?? null;
}

export function parseXlsx(input, { sheet, headerRow, maxRows = 10000 } = {}) {
  const entries = extractZipEntries(input);
  const workbook = resolveWorkbook(entries);
  const selected = selectSheet(workbook.sheets, sheet);
  if (!selected) throw xlsxError('VF_XLSX_SHEET_NOT_FOUND', `Worksheet not found: ${sheet}`);
  const sheetBuffer = entries.get(selected.path);
  if (!sheetBuffer) throw xlsxError('VF_XLSX_SHEET_MISSING', `Worksheet XML is missing: ${selected.path}`);
  const sharedStrings = parseSharedStrings(entries);
  const dateStyles = parseDateStyles(entries);
  const table = parseWorksheet(sheetBuffer.toString('utf8'), { sharedStrings, dateStyles, date1904: workbook.date1904, maxRows });

  const requestedHeaderIndex = headerRow == null ? null : Number(headerRow) - 1;
  const headerIndex = requestedHeaderIndex ?? table.findIndex((row) => row.some((value) => String(value ?? '').trim() !== ''));
  if (headerIndex < 0 || headerIndex >= table.length) throw xlsxError('VF_XLSX_HEADER_MISSING', 'Could not find the XLSX header row');
  const headers = (table[headerIndex] ?? []).map((value) => String(value ?? '').trim());
  while (headers.length && !headers.at(-1)) headers.pop();
  if (headers.length === 0 || headers.some((header) => !header)) throw xlsxError('VF_XLSX_HEADER_INVALID', 'XLSX header row contains blank column names');
  if (new Set(headers).size !== headers.length) throw xlsxError('VF_XLSX_HEADER_DUPLICATE', 'XLSX header row contains duplicate column names');

  const rows = table.slice(headerIndex + 1, headerIndex + 1 + maxRows)
    .filter((values) => values.some((value) => String(value ?? '').trim() !== ''))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));

  return {
    format: 'xlsx',
    sheetName: selected.name,
    sheetIndex: workbook.sheets.indexOf(selected),
    sheets: workbook.sheets.map(({ name, state }) => ({ name, state })),
    headerRow: headerIndex + 1,
    headers,
    rows,
  };
}
