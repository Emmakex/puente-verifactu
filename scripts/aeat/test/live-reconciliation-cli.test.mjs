import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlitePersistence } from '../../../packages/sqlite-store/src/index.mjs';
import {
  parseLiveReconciliationOptions,
  runLiveReconciliation,
} from '../live-reconciliation-lib.mjs';

const issuer = { name: 'Empresa Demo SL', taxId: 'B12345678' };
const intent = {
  schemaVersion: 1,
  operation: 'issue',
  organizationId: 'org-1',
  installationId: 'source-1',
  sourceSystem: 'test',
  sourceInvoiceId: 'secret-ref-001',
  series: 'A-',
  number: '42',
  issueDate: '2026-09-15',
  invoiceType: 'F1',
  description: 'Test',
  issuer,
  recipients: [],
  currency: 'EUR',
  taxBreakdown: [{ taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '21', baseAmount: '1.00', taxAmount: '0.21' }],
  adjustments: [],
  totals: { baseAmount: '1.00', taxAmount: '0.21', totalAmount: '1.21' },
};
const record = {
  schemaVersion: 1,
  recordType: 'alta',
  sequence: 1,
  organizationId: 'org-1',
  chainKey: 'org-1\u001fPV\u001f001',
  sif: { systemId: 'PV', installationNumber: '001' },
  invoice: { issuerTaxId: 'B12345678', fiscalNumber: 'A-42', issueDate: '2026-09-15' },
  invoiceType: 'F1',
  quotaTotal: '0.21',
  totalAmount: '1.21',
  firstRecord: true,
  previous: null,
  generatedAt: '2026-09-15T10:00:00+02:00',
  hashType: '01',
  hash: 'A'.repeat(64),
  source: { installationId: 'source-1', sourceSystem: 'test', sourceInvoiceId: 'secret-ref-001' },
};

function queryResponse({ found = true, hash = 'A'.repeat(64) } = {}) {
  const row = found ? `<q:RegistroRespuestaConsultaFactuSistemaFacturacion>
    <q:IDFactura><sf:IDEmisorFactura>B12345678</sf:IDEmisorFactura><sf:NumSerieFactura>A-42</sf:NumSerieFactura><sf:FechaExpedicionFactura>15-09-2026</sf:FechaExpedicionFactura></q:IDFactura>
    <q:DatosRegistroFacturacion><sf:RefExterna>secret-ref-001</sf:RefExterna><sf:TipoFactura>F1</sf:TipoFactura><sf:FechaHoraHusoGenRegistro>2026-09-15T10:00:00+02:00</sf:FechaHoraHusoGenRegistro><sf:TipoHuella>01</sf:TipoHuella><sf:Huella>${hash}</sf:Huella></q:DatosRegistroFacturacion>
    <q:DatosPresentacion><sf:NIFPresentador>B12345678</sf:NIFPresentador><sf:TimestampPresentacion>2026-09-15T10:00:03+02:00</sf:TimestampPresentacion><sf:IdPeticion>REQ-PRIVATE-001</sf:IdPeticion></q:DatosPresentacion>
    <q:EstadoRegistro><q:TimestampUltimaModificacion>2026-09-15T10:00:04+02:00</q:TimestampUltimaModificacion><q:EstadoRegistro>Correcto</q:EstadoRegistro></q:EstadoRegistro>
  </q:RegistroRespuestaConsultaFactuSistemaFacturacion>` : '';
  return `<?xml version="1.0"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:q="urn:q" xmlns:sf="urn:sf"><env:Body><q:RespuestaConsultaFactuSistemaFacturacion><q:PeriodoImputacion><sf:Ejercicio>2026</sf:Ejercicio><sf:Periodo>09</sf:Periodo></q:PeriodoImputacion><q:IndicadorPaginacion>N</q:IndicadorPaginacion><q:ResultadoConsulta>${found ? 'ConDatos' : 'SinDatos'}</q:ResultadoConsulta>${row}</q:RespuestaConsultaFactuSistemaFacturacion></env:Body></env:Envelope>`;
}

async function createUncertainDatabase(root, jobId = 'very-secret-job-id') {
  const dbPath = join(root, 'runtime.sqlite');
  const persistence = createSqlitePersistence({ path: dbPath });
  const job = persistence.aeatOutbox.enqueue({ issuer, entries: [{ intent, record }] }, { id: jobId, availableAt: 0, now: 1 });
  persistence.aeatOutbox.claim(job.id, { owner: 'dispatch', now: 2, leaseMs: 1000 });
  persistence.aeatOutbox.settle(job.id, {
    owner: 'dispatch',
    state: 'reconciliation_required',
    lastResult: { kind: 'reconciliation_required', reason: 'transport_outcome_unknown' },
    now: 3,
  });
  persistence.close();
  return { dbPath, jobId };
}

function fakeDependencies(response = queryResponse()) {
  let networkCalls = 0;
  return {
    get networkCalls() { return networkCalls; },
    deps: {
      loadPfxCredentials: async () => ({
        pfx: Buffer.from('fake-pfx-for-test'),
        passphrase: 'super-secret-passphrase',
        summary: {
          schemaVersion: 1,
          status: 'ok',
          pfxSha256: 'f'.repeat(64),
          passphraseSource: 'file',
          networkUsed: false,
        },
      }),
      createHttpsMtlsTransport: () => async ({ body }) => {
        networkCalls += 1;
        assert.match(body, /ConsultaFactuSistemaFacturacion/);
        assert.doesNotMatch(body, /RegFactuSistemaFacturacion/);
        return { statusCode: 200, headers: {}, body: response };
      },
    },
  };
}

async function storedState(dbPath, jobId) {
  const persistence = createSqlitePersistence({ path: dbPath });
  try {
    return persistence.aeatOutbox.get(jobId)?.state ?? null;
  } finally {
    persistence.close();
  }
}

test('options require explicit apply guard and commit for evidence', () => {
  assert.throws(
    () => parseLiveReconciliationOptions(['--db', 'x.sqlite', '--job-id', 'j', '--apply'], {}),
    { code: 'VF_AEAT_RECONCILIATION_APPLY_GUARD' },
  );
  assert.throws(
    () => parseLiveReconciliationOptions(['--db', 'x.sqlite', '--job-id', 'j', '--evidence-output', 'x.json'], {}),
    { code: 'VF_AEAT_RECONCILIATION_SOURCE_COMMIT_REQUIRED' },
  );
  assert.throws(
    () => parseLiveReconciliationOptions(['--db', 'x.sqlite', '--job-id', 'j', '--send'], {}),
    { code: 'VF_AEAT_RECONCILIATION_OPTION_UNKNOWN' },
  );
});

test('inspect mode uses official query and leaves SQLite job quarantined', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pvf-reconcile-inspect-'));
  try {
    const { dbPath, jobId } = await createUncertainDatabase(root);
    const fake = fakeDependencies();
    const result = await runLiveReconciliation({
      argv: ['--db', dbPath, '--job-id', jobId],
      env: {},
      clock: () => new Date('2026-09-16T00:00:00.000Z'),
      dependencies: fake.deps,
    });

    assert.equal(result.mode, 'inspect');
    assert.equal(result.assessment.allReceived, true);
    assert.equal(result.assessment.applied, false);
    assert.equal(result.assessment.shouldReissue, false);
    assert.deepEqual(result.entryRecordHashes, ['A'.repeat(64)]);
    assert.equal(result.afterState, 'reconciliation_required');
    assert.equal(await storedState(dbPath, jobId), 'reconciliation_required');
    assert.equal(fake.networkCalls, 1);

    const publicOutput = JSON.stringify(result);
    for (const secret of [jobId, 'B12345678', 'A-42', 'secret-ref-001', 'REQ-PRIVATE-001', 'super-secret-passphrase', dbPath]) {
      assert.doesNotMatch(publicOutput, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('apply mode completes only after exact AEAT match and double guard', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pvf-reconcile-apply-'));
  try {
    const { dbPath, jobId } = await createUncertainDatabase(root);
    const fake = fakeDependencies();
    const result = await runLiveReconciliation({
      argv: ['--db', dbPath, '--job-id', jobId, '--apply'],
      env: { AEAT_RECONCILIATION_APPLY: 'YES' },
      dependencies: fake.deps,
    });

    assert.equal(result.mode, 'apply');
    assert.equal(result.assessment.allReceived, true);
    assert.equal(result.assessment.applied, true);
    assert.equal(result.assessment.shouldReissue, false);
    assert.deepEqual(result.entryRecordHashes, ['A'.repeat(64)]);
    assert.equal(result.afterState, 'completed');
    assert.equal(await storedState(dbPath, jobId), 'completed');
    assert.equal(fake.networkCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SinDatos in apply mode stays quarantined and never becomes retry-safe', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pvf-reconcile-not-found-'));
  try {
    const { dbPath, jobId } = await createUncertainDatabase(root);
    const fake = fakeDependencies(queryResponse({ found: false }));
    const result = await runLiveReconciliation({
      argv: ['--db', dbPath, '--job-id', jobId, '--apply'],
      env: { AEAT_RECONCILIATION_APPLY: 'YES' },
      dependencies: fake.deps,
    });

    assert.equal(result.assessment.allReceived, false);
    assert.equal(result.assessment.applied, false);
    assert.equal(result.assessment.shouldReissue, false);
    assert.deepEqual(result.entryRecordHashes, ['A'.repeat(64)]);
    assert.equal(result.assessment.entries[0].outcome, 'not_found');
    assert.equal(await storedState(dbPath, jobId), 'reconciliation_required');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('evidence is non-overwriting, mode 0600 and sanitized', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pvf-reconcile-evidence-'));
  try {
    const { dbPath, jobId } = await createUncertainDatabase(root);
    const evidencePath = join(root, 'private', 'reconciliation.json');
    const fake = fakeDependencies();
    const sourceCommit = 'a'.repeat(40);
    await runLiveReconciliation({
      argv: ['--db', dbPath, '--job-id', jobId, '--source-commit', sourceCommit, '--evidence-output', evidencePath],
      env: {},
      dependencies: fake.deps,
    });

    const evidence = await readFile(evidencePath, 'utf8');
    const parsed = JSON.parse(evidence);
    const mode = (await stat(evidencePath)).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.match(evidence, new RegExp(sourceCommit));
    assert.match(evidence, /"shouldReissue": false/);
    assert.deepEqual(parsed.entryRecordHashes, ['A'.repeat(64)]);
    for (const secret of [jobId, 'B12345678', 'A-42', 'secret-ref-001', 'REQ-PRIVATE-001', 'super-secret-passphrase', dbPath]) {
      assert.doesNotMatch(evidence, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    await assert.rejects(
      () => runLiveReconciliation({
        argv: ['--db', dbPath, '--job-id', jobId, '--source-commit', sourceCommit, '--evidence-output', evidencePath],
        env: {},
        dependencies: fake.deps,
      }),
      { code: 'VF_AEAT_RECONCILIATION_EVIDENCE_EXISTS' },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing database fails before credentials or network are touched', async () => {
  let credentialsLoaded = 0;
  await assert.rejects(
    () => runLiveReconciliation({
      argv: ['--db', '/definitely/missing/puente.sqlite', '--job-id', 'j'],
      env: {},
      dependencies: {
        loadPfxCredentials: async () => { credentialsLoaded += 1; throw new Error('should not load'); },
      },
    }),
    { code: 'VF_AEAT_RECONCILIATION_DB_UNREADABLE' },
  );
  assert.equal(credentialsLoaded, 0);
});
