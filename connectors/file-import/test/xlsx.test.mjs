import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectImportFile } from '../src/file-reader.mjs';
import { parseXlsx } from '../src/xlsx.mjs';

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, source] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.from(source, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }

  const localBuffer = Buffer.concat(locals);
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(localBuffer.length, 16);
  return Buffer.concat([localBuffer, centralBuffer, eocd]);
}

function excelSerial(isoDate) {
  return Math.floor((Date.parse(`${isoDate}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);
}

function workbook({ unsafe = false } = {}) {
  const headers = ['Nº Factura', 'Fecha factura', 'Tipo factura', 'Concepto', 'Base imponible', 'Cuota IVA', 'Total factura'];
  const strings = [...headers, 'A-1', 'F2', 'Servicio mensual'];
  const shared = strings.map((value) => `<si><t>${value}</t></si>`).join('');
  const headerCells = headers.map((_, index) => `<c r="${String.fromCharCode(65 + index)}1" t="s"><v>${index}</v></c>`).join('');
  const row = [
    '<c r="A2" t="s"><v>7</v></c>',
    `<c r="B2" s="1"><v>${excelSerial('2026-09-15')}</v></c>`,
    '<c r="C2" t="s"><v>8</v></c>',
    '<c r="D2" t="s"><v>9</v></c>',
    '<c r="E2"><v>100</v></c>',
    '<c r="F2"><v>21</v></c>',
    '<c r="G2"><v>121</v></c>',
  ].join('');
  const workbookXml = `${unsafe ? '<!DOCTYPE x [<!ENTITY boom SYSTEM "file:///etc/passwd">]>' : ''}<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="0"/><sheets><sheet name="Facturas" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  return zip({
    'xl/workbook.xml': workbookXml,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst>${shared}</sst>`,
    'xl/styles.xml': '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1">${headerCells}</row><row r="2">${row}</row></sheetData></worksheet>`,
  });
}

test('reads XLSX shared strings, numbers and Excel date cells without dependencies', () => {
  const parsed = parseXlsx(workbook());
  assert.equal(parsed.sheetName, 'Facturas');
  assert.equal(parsed.headers[0], 'Nº Factura');
  assert.equal(parsed.rows[0]['Nº Factura'], 'A-1');
  assert.equal(parsed.rows[0]['Fecha factura'], '2026-09-15');
  assert.equal(parsed.rows[0]['Total factura'], '121');
});

test('XLSX inspection returns mapping suggestions and workbook metadata', () => {
  const constants = {
    issuer: { name: 'Empresa Demo', taxId: 'TESTISSUER' },
    currency: 'EUR',
    taxBreakdown: [{ taxCode: '01', regimeKey: '01', operationClass: 'S1' }],
  };
  const inspection = inspectImportFile(workbook(), { filename: 'facturas.xlsx', constants });
  assert.equal(inspection.file.format, 'xlsx');
  assert.equal(inspection.file.sheetName, 'Facturas');
  assert.equal(inspection.assistant.profile.fields['Nº Factura'], 'number');
  assert.equal(inspection.assistant.profile.fields['Fecha factura'], 'issueDate');
  assert.equal(inspection.assistant.missingConfiguration.length, 0);
  assert.equal(inspection.assistant.missingEssentialTargets.length, 0);
});

test('rejects DTD/entity declarations inside XLSX XML', () => {
  assert.throws(() => parseXlsx(workbook({ unsafe: true })), { code: 'VF_XLSX_XML_UNSAFE' });
});
