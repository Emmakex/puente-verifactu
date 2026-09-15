import test from 'node:test';
import assert from 'node:assert/strict';
import { AeatVerifactuAdapter } from '../src/adapter.mjs';
import { MemoryAeatOutbox } from '../src/outbox.mjs';
import { parseAeatQueryResponse, periodFromDate, serializeAeatQueryRequest } from '../src/query.mjs';
import { AeatOfficialReconciler, assessAeatQueryReconciliation } from '../src/reconciliation.mjs';

const sif = {
  producerName: 'Kairoseth Extensions',
  producerTaxId: 'B12345678',
  softwareName: 'Puente VeriFactu',
  systemId: 'PV',
  version: '0.1.0',
  installationNumber: '001',
  onlyVerifactu: true,
  possibleMultiTaxpayer: true,
  multipleTaxpayers: false,
};
const issuer = { name: 'Empresa Demo SL', taxId: 'B12345678' };
const intent = {
  schemaVersion: 1,
  operation: 'issue',
  organizationId: 'org-1',
  installationId: 'source-1',
  sourceSystem: 'csv',
  sourceInvoiceId: 'invoice-1',
  series: 'A-',
  number: '1',
  issueDate: '2026-09-15',
  invoiceType: 'F1',
  description: 'Servicio',
  issuer,
  recipients: [],
  currency: 'EUR',
  taxBreakdown: [{ taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '21', baseAmount: '100.00', taxAmount: '21.00' }],
  adjustments: [],
  totals: { baseAmount: '100.00', taxAmount: '21.00', totalAmount: '121.00' },
};
const record = {
  schemaVersion: 1,
  recordType: 'alta',
  sequence: 1,
  organizationId: 'org-1',
  chainKey: 'org-1\u001fPV\u001f001',
  sif: { systemId: 'PV', installationNumber: '001' },
  invoice: { issuerTaxId: 'B12345678', fiscalNumber: 'A-1', issueDate: '2026-09-15' },
  invoiceType: 'F1',
  quotaTotal: '21.00',
  totalAmount: '121.00',
  firstRecord: true,
  previous: null,
  generatedAt: '2026-09-15T10:00:00+02:00',
  hashType: '01',
  hash: 'A'.repeat(64),
  source: { installationId: 'source-1', sourceSystem: 'csv', sourceInvoiceId: 'invoice-1' },
};

function queryResponse({
  result = 'ConDatos',
  refExternal = 'invoice-1',
  fiscalNumber = 'A-1',
  issueDate = '15-09-2026',
  hash = 'A'.repeat(64),
  state = 'Correcto',
  pagination = 'N',
  extraRecord = '',
} = {}) {
  const row = result === 'ConDatos' ? `<q:RegistroRespuestaConsultaFactuSistemaFacturacion>
    <q:IDFactura><sf:IDEmisorFactura>B12345678</sf:IDEmisorFactura><sf:NumSerieFactura>${fiscalNumber}</sf:NumSerieFactura><sf:FechaExpedicionFactura>${issueDate}</sf:FechaExpedicionFactura></q:IDFactura>
    <q:DatosRegistroFacturacion><sf:RefExterna>${refExternal}</sf:RefExterna><sf:TipoFactura>F1</sf:TipoFactura><sf:FechaHoraHusoGenRegistro>2026-09-15T10:00:00+02:00</sf:FechaHoraHusoGenRegistro><sf:TipoHuella>01</sf:TipoHuella><sf:Huella>${hash}</sf:Huella></q:DatosRegistroFacturacion>
    <q:DatosPresentacion><sf:NIFPresentador>B12345678</sf:NIFPresentador><sf:TimestampPresentacion>2026-09-15T10:00:03+02:00</sf:TimestampPresentacion><sf:IdPeticion>REQ123</sf:IdPeticion></q:DatosPresentacion>
    <q:EstadoRegistro><q:TimestampUltimaModificacion>2026-09-15T10:00:04+02:00</q:TimestampUltimaModificacion><q:EstadoRegistro>${state}</q:EstadoRegistro></q:EstadoRegistro>
  </q:RegistroRespuestaConsultaFactuSistemaFacturacion>` : '';
  return `<?xml version="1.0"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:q="urn:q" xmlns:sf="urn:sf"><env:Body><q:RespuestaConsultaFactuSistemaFacturacion><q:Cabecera/><q:PeriodoImputacion><sf:Ejercicio>2026</sf:Ejercicio><sf:Periodo>09</sf:Periodo></q:PeriodoImputacion><q:IndicadorPaginacion>${pagination}</q:IndicadorPaginacion><q:ResultadoConsulta>${result}</q:ResultadoConsulta>${row}${extraRecord}</q:RespuestaConsultaFactuSistemaFacturacion></env:Body></env:Envelope>`;
}

function uncertainOutbox(entries = [{ intent, record }]) {
  const outbox = new MemoryAeatOutbox();
  const job = outbox.enqueue({ issuer, entries }, { id: 'job-1', availableAt: 0 });
  outbox.claim(job.id, { owner: 'dispatch', now: 0, leaseMs: 1000 });
  outbox.settle(job.id, {
    owner: 'dispatch',
    state: 'reconciliation_required',
    lastResult: { kind: 'reconciliation_required', reason: 'transport_outcome_unknown' },
    now: 1,
  });
  return outbox;
}

test('serializes official query using period and RefExterna', () => {
  const xml = serializeAeatQueryRequest({ issuer, period: { year: '2026', period: '09' }, refExternal: 'invoice-1' });
  assert.match(xml, /<con:ConsultaFactuSistemaFacturacion>/);
  assert.match(xml, /<sf:IDVersion>1.0<\/sf:IDVersion>/);
  assert.match(xml, /<sf:Ejercicio>2026<\/sf:Ejercicio><sf:Periodo>09<\/sf:Periodo>/);
  assert.match(xml, /<con:RefExterna>invoice-1<\/con:RefExterna>/);
  assert.doesNotMatch(xml, /RegistroFactura|RegistroAlta/);
});

test('query pagination key serializes AEAT date format', () => {
  const xml = serializeAeatQueryRequest({
    issuer,
    period: { year: '2026', period: '09' },
    refExternal: 'invoice-1',
    pageKey: { issuerTaxId: 'B12345678', fiscalNumber: 'A-1', issueDate: '2026-09-15' },
  });
  assert.match(xml, /<sf:FechaExpedicionFactura>15-09-2026<\/sf:FechaExpedicionFactura>/);
});

test('period derives from operation date or issue date month', () => {
  assert.deepEqual(periodFromDate('2026-09-15'), { year: '2026', period: '09' });
  assert.throws(() => periodFromDate('15-09-2026'), { code: 'VF_AEAT_QUERY_DATE_INVALID' });
});

test('parses ConDatos query response and normalizes AEAT date/state', () => {
  const parsed = parseAeatQueryResponse(queryResponse());
  assert.equal(parsed.status, 'found');
  assert.equal(parsed.pagination, false);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].issueDate, '2026-09-15');
  assert.equal(parsed.records[0].refExternal, 'invoice-1');
  assert.equal(parsed.records[0].storedState, 'accepted');
  assert.equal(parsed.records[0].requestId, 'REQ123');
  assert.equal(parsed.records[0].hash, 'A'.repeat(64));
});

test('parses SinDatos without inventing retry safety', () => {
  const parsed = parseAeatQueryResponse(queryResponse({ result: 'SinDatos' }));
  assert.equal(parsed.status, 'not_found');
  assert.deepEqual(parsed.records, []);
  const assessment = assessAeatQueryReconciliation(parsed, {
    issuerTaxId: 'B12345678', fiscalNumber: 'A-1', issueDate: '2026-09-15', refExternal: 'invoice-1', hash: 'A'.repeat(64),
  });
  assert.equal(assessment.outcome, 'not_found');
  assert.equal(assessment.retrySafe, false);
  assert.equal(assessment.shouldReissue, false);
});

test('query parser rejects DTD/entity XML and normalizes SOAP fault', () => {
  assert.throws(() => parseAeatQueryResponse('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>'), { code: 'VF_AEAT_XML_UNSAFE' });
  const parsed = parseAeatQueryResponse('<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><env:Fault><faultstring>Codigo[4104]. Consulta no válida</faultstring></env:Fault></env:Body></env:Envelope>');
  assert.equal(parsed.kind, 'soap_fault');
  assert.equal(parsed.errorCode, '4104');
});

test('adapter query uses same official endpoint but does not submit or use submit throttle', async () => {
  const calls = [];
  let now = 0;
  const adapter = new AeatVerifactuAdapter({
    sif,
    clock: () => now,
    transport: async ({ url, body }) => {
      calls.push({ url, body });
      if (body.includes('RegFactuSistemaFacturacion')) {
        return { statusCode: 200, headers: {}, body: '<x><EstadoEnvio>Correcto</EstadoEnvio><TiempoEsperaEnvio>60</TiempoEsperaEnvio></x>' };
      }
      return { statusCode: 200, headers: {}, body: queryResponse() };
    },
  });
  await adapter.submit({ issuer, entries: [{ intent, record }] });
  const queried = await adapter.queryPresentedRecords({ issuer, period: { year: '2026', period: '09' }, refExternal: 'invoice-1' });
  assert.equal(queried.status, 'found');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.match(calls[1].body, /ConsultaFactuSistemaFacturacion/);
  now = 1;
  await assert.rejects(() => adapter.submit({ issuer, entries: [{ intent, record }] }), { code: 'VF_AEAT_THROTTLED' });
});

test('exact official query match completes quarantined outbox without reissuing', async () => {
  let queryCalls = 0;
  let submitCalls = 0;
  const adapter = {
    submit: async () => { submitCalls += 1; throw new Error('must not submit'); },
    queryPresentedRecords: async ({ refExternal }) => {
      queryCalls += 1;
      assert.equal(refExternal, 'invoice-1');
      return parseAeatQueryResponse(queryResponse());
    },
  };
  const outbox = uncertainOutbox();
  const reconciler = new AeatOfficialReconciler({ adapter, outbox, clock: () => 5000 });
  const result = await reconciler.inspect('job-1');
  assert.equal(result.assessment.allReceived, true);
  assert.equal(result.assessment.shouldReissue, false);
  assert.equal(result.job.state, 'completed');
  assert.equal(queryCalls, 1);
  assert.equal(submitCalls, 0);
});

test('SinDatos leaves job in reconciliation_required and never reissues', async () => {
  let submitCalls = 0;
  const adapter = {
    submit: async () => { submitCalls += 1; },
    queryPresentedRecords: async () => parseAeatQueryResponse(queryResponse({ result: 'SinDatos' })),
  };
  const outbox = uncertainOutbox();
  const reconciler = new AeatOfficialReconciler({ adapter, outbox });
  const result = await reconciler.inspect('job-1');
  assert.equal(result.assessment.allReceived, false);
  assert.equal(result.assessment.entries[0].assessment.outcome, 'not_found');
  assert.equal(result.job.state, 'reconciliation_required');
  assert.equal(submitCalls, 0);
});

test('identity/hash mismatch and pagination remain quarantined', async () => {
  for (const response of [
    queryResponse({ hash: 'B'.repeat(64) }),
    queryResponse({ pagination: 'S' }),
  ]) {
    const adapter = { queryPresentedRecords: async () => parseAeatQueryResponse(response) };
    const outbox = uncertainOutbox();
    const result = await new AeatOfficialReconciler({ adapter, outbox }).inspect('job-1');
    assert.equal(result.assessment.allReceived, false);
    assert.equal(outbox.get('job-1').state, 'reconciliation_required');
    assert.equal(result.assessment.entries[0].assessment.shouldReissue, false);
  }
});

test('query transport failure remains reconciliation_required', async () => {
  const adapter = {
    queryPresentedRecords: async () => ({ kind: 'transport_error', status: 'fault', errorCode: 'VF_AEAT_TIMEOUT', records: [] }),
  };
  const outbox = uncertainOutbox();
  const result = await new AeatOfficialReconciler({ adapter, outbox }).inspect('job-1');
  assert.equal(result.assessment.entries[0].assessment.outcome, 'query_error');
  assert.equal(outbox.get('job-1').state, 'reconciliation_required');
});

test('batch completes only when every entry is found exactly', async () => {
  const intent2 = { ...intent, sourceInvoiceId: 'invoice-2', number: '2' };
  const record2 = {
    ...record,
    invoice: { ...record.invoice, fiscalNumber: 'A-2' },
    source: { ...record.source, sourceInvoiceId: 'invoice-2' },
    hash: 'B'.repeat(64),
  };
  const responses = {
    'invoice-1': parseAeatQueryResponse(queryResponse()),
    'invoice-2': parseAeatQueryResponse(queryResponse({ refExternal: 'invoice-2', fiscalNumber: 'A-2', hash: 'B'.repeat(64) })),
  };
  const adapter = { queryPresentedRecords: async ({ refExternal }) => responses[refExternal] };
  const outbox = uncertainOutbox([{ intent, record }, { intent: intent2, record: record2 }]);
  const result = await new AeatOfficialReconciler({ adapter, outbox }).inspect('job-1');
  assert.equal(result.assessment.entries.length, 2);
  assert.equal(result.assessment.allReceived, true);
  assert.equal(result.job.state, 'completed');
});
