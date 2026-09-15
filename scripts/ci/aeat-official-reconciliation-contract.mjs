import { existsSync, readFileSync } from 'node:fs';

const required = [
  'packages/aeat-adapter/src/query.mjs',
  'packages/aeat-adapter/src/reconciliation.mjs',
  'packages/aeat-adapter/test/query-reconciliation.test.mjs',
];

const failures = [];
for (const path of required) {
  if (!existsSync(path)) failures.push({ code: 'AEAT_RECONCILIATION_PATH_MISSING', path });
}

const query = existsSync(required[0]) ? readFileSync(required[0], 'utf8') : '';
const reconciler = existsSync(required[1]) ? readFileSync(required[1], 'utf8') : '';
const tests = existsSync(required[2]) ? readFileSync(required[2], 'utf8') : '';

for (const marker of [
  'ConsultaFactuSistemaFacturacion',
  'PeriodoImputacion',
  'RefExterna',
  'ResultadoConsulta',
  'IndicadorPaginacion',
]) {
  if (!query.includes(marker)) failures.push({ code: 'AEAT_RECONCILIATION_QUERY_CONTRACT_MISSING', marker });
}

for (const marker of [
  'queryPresentedRecords',
  "action: 'complete'",
  'shouldReissue: false',
  'not_found_is_not_proof_of_safe_reissue',
  'query_data_does_not_match_fiscal_identity',
]) {
  if (!reconciler.includes(marker)) failures.push({ code: 'AEAT_RECONCILIATION_SAFETY_CONTRACT_MISSING', marker });
}

if (/\.submit\s*\(/.test(reconciler)) {
  failures.push({ code: 'AEAT_RECONCILIATION_MUST_NOT_SUBMIT' });
}
if (/action\s*:\s*['"]retry['"]/.test(reconciler)) {
  failures.push({ code: 'AEAT_RECONCILIATION_MUST_NOT_AUTO_RETRY' });
}

for (const marker of [
  'SinDatos leaves job in reconciliation_required and never reissues',
  'identity/hash mismatch and pagination remain quarantined',
  'query transport failure remains reconciliation_required',
  'batch completes only when every entry is found exactly',
]) {
  if (!tests.includes(marker)) failures.push({ code: 'AEAT_RECONCILIATION_TEST_CONTRACT_MISSING', marker });
}

if (failures.length) {
  console.error(JSON.stringify({
    schema_version: 1,
    check: 'aeat-official-reconciliation-contract',
    status: 'failed',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  check: 'aeat-official-reconciliation-contract',
  status: 'ok',
  invariants: {
    official_query_operation: true,
    exact_match_only: true,
    no_submit_from_reconciler: true,
    no_automatic_retry: true,
  },
}, null, 2));
