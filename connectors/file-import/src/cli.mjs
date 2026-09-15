import { readFile } from 'node:fs/promises';
import { inferMapping } from '../../../packages/core/src/mapping.mjs';
import { preflightRows } from '../../../packages/core/src/preflight.mjs';
import { parseCsv } from './csv.mjs';

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--infer') result.infer = true;
    else if (token.startsWith('--')) result[token.slice(2)] = argv[index += 1];
  }
  return result;
}

const options = args(process.argv.slice(2));
if (!options.csv) {
  console.error('Usage: cli.mjs --csv <file> [--profile <file> | --infer]');
  process.exit(2);
}

const csv = parseCsv(await readFile(options.csv, 'utf8'));
if (options.infer) {
  console.log(JSON.stringify(inferMapping(csv.headers), null, 2));
  process.exit(0);
}
if (!options.profile) {
  console.error('A MappingProfile is required unless --infer is used.');
  process.exit(2);
}

const profile = JSON.parse(await readFile(options.profile, 'utf8'));
const report = preflightRows(csv.rows, profile);
console.log(JSON.stringify({
  mode: report.mode,
  ok: report.ok,
  summary: report.summary,
  rows: report.rows.map((row) => ({ row: row.row, status: row.status, errors: row.errors, warnings: row.warnings })),
}, null, 2));
process.exit(report.ok ? 0 : 1);
