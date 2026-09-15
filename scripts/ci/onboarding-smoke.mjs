import { ImportSessionService } from '../../apps/api/src/imports.mjs';
import {
  COPY,
  initialSelections,
  preflightPayload,
} from '../../apps/onboarding/src/model.mjs';

function fail(code, context = {}) {
  const diagnostic = {
    schema_version: 1,
    pipeline: 'GitHub Actions',
    job: 'validation',
    step: 'zero-code-onboarding-smoke',
    command: 'node scripts/ci/onboarding-smoke.mjs',
    exit_code: 1,
    primary_error: code,
    context,
    root_cause_status: 'confirmed',
  };
  console.error(JSON.stringify(diagnostic, null, 2));
  console.error(`::error title=${code}::Zero-code onboarding smoke failed.`);
  process.exit(1);
}

const context = {
  organizationId: 'org-smoke',
  installationId: 'install-smoke',
  sourceSystem: 'file-upload-smoke',
};

const csv = Buffer.from([
  'Nº Factura;Fecha factura;Concepto;Base imponible;Cuota IVA;Total factura',
  'SMOKE-1;15/09/2026;Servicio de prueba;100,00;21,00;121,00',
].join('\n'));

const configuration = {
  'issuer.name': 'Empresa Demo',
  'issuer.taxId': 'TESTISSUER',
  currency: 'EUR',
  'taxBreakdown.0.taxCode': '01',
  'taxBreakdown.0.regimeKey': '01',
  'taxBreakdown.0.operationClass': 'S1',
  'taxBreakdown.0.rate': '21',
  invoiceType: 'F2',
};

if (!COPY.es?.title || !COPY.en?.title) fail('ONBOARDING_I18N_CONTRACT_MISSING');

const imports = new ImportSessionService({
  clock: () => Date.parse('2026-09-15T09:00:00Z'),
});

const inspection = imports.inspect({
  buffer: csv,
  filename: 'facturas-smoke.csv',
  context,
});

if (inspection.file.format !== 'csv') fail('ONBOARDING_FORMAT_NOT_DETECTED', { file: inspection.file });
if (!inspection.assistant?.profile?.fields?.['Nº Factura']) {
  fail('ONBOARDING_MAPPING_NOT_INFERRED', { assistant: inspection.assistant?.summary });
}

const selections = initialSelections(inspection);
const payload = preflightPayload(selections, configuration);
const report = imports.preflight(inspection.importId, context, payload);

if (!report.ok || report.summary.valid !== 1 || report.summary.invalid !== 0) {
  fail('ONBOARDING_PREFLIGHT_FAILED', { summary: report.summary, rows: report.rows });
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'zero-code-onboarding',
  locale_contract: ['es', 'en'],
  format: inspection.file.format,
  rows: report.summary.rows,
  valid: report.summary.valid,
}, null, 2));
