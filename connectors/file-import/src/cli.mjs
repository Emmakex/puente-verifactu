import { readFile } from 'node:fs/promises';
import { acceptMappingSuggestions } from '../../../packages/core/src/mapping-assistant.mjs';
import { preflightRows } from '../../../packages/core/src/preflight.mjs';
import { inspectImportFile, parseImportFile } from './file-reader.mjs';

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--infer') result.infer = true;
    else if (token.startsWith('--')) result[token.slice(2)] = argv[index += 1];
  }
  return result;
}

function usage() {
  return [
    'Usage:',
    '  cli.mjs --file <facturas.csv|facturas.xlsx> [--sheet <name|index>] [--header-row <n>] --infer',
    '  cli.mjs --file <facturas.csv|facturas.xlsx> [--sheet <name|index>] [--header-row <n>] --profile <mapping.json>',
    '',
    'Compatibility: --csv <file> and --xlsx <file> are accepted as aliases for --file.',
  ].join('\n');
}

const options = args(process.argv.slice(2));
const filePath = options.file ?? options.csv ?? options.xlsx;
if (!filePath) {
  console.error(usage());
  process.exit(2);
}

const buffer = await readFile(filePath);
const parseOptions = {
  filename: filePath,
  format: options.csv ? 'csv' : options.xlsx ? 'xlsx' : undefined,
  sheet: options.sheet,
  headerRow: options['header-row'] ? Number(options['header-row']) : undefined,
};

if (options.infer) {
  const inspection = inspectImportFile(buffer, parseOptions);
  console.log(JSON.stringify(inspection, null, 2));
  process.exit(0);
}

if (!options.profile) {
  console.error('A MappingProfile is required unless --infer is used.');
  console.error(usage());
  process.exit(2);
}

const table = parseImportFile(buffer, parseOptions);
const profileInput = JSON.parse(await readFile(options.profile, 'utf8'));
const assistantReport = profileInput.assistantVersion === 1 ? profileInput : profileInput.assistant;
const profile = assistantReport?.assistantVersion === 1
  ? acceptMappingSuggestions(assistantReport, profileInput.acceptedSources ?? assistantReport.acceptedSources ?? [])
  : profileInput;
const report = preflightRows(table.rows, profile);
console.log(JSON.stringify({
  mode: report.mode,
  ok: report.ok,
  input: {
    format: table.format,
    sheetName: table.sheetName ?? null,
    headerRow: table.headerRow ?? 1,
  },
  summary: report.summary,
  rows: report.rows.map((row) => ({ row: row.row, status: row.status, errors: row.errors, warnings: row.warnings })),
}, null, 2));
process.exit(report.ok ? 0 : 1);
