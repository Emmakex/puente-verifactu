import test from 'node:test';
import assert from 'node:assert/strict';
import { AeatVerifactuAdapter } from '../src/adapter.mjs';
import { AEAT_ENDPOINTS } from '../src/constants.mjs';
import { AeatOutboxWorker, MemoryAeatOutbox } from '../src/outbox.mjs';
import { parseAeatSoapResponse } from '../src/response.mjs';
import { serializeAeatSoapRequest } from '../src/serialize.mjs';

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
  description: 'Servicio & soporte',
  issuer: { name: 'Empresa <Demo>', taxId: 'B12345678' },
  recipients: [{ name: 'Cliente SL', taxId: 'B87654321' }],
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

const issuer = { name: 'Empresa <Demo>', taxId: 'B12345678' };

test('serializes a basic alta with AEAT namespaces and escaped values', () => {
  const xml = serializeAeatSoapRequest({ issuer, entries: [{ intent, record }], sif });
  assert.match(xml, /<lr:RegFactuSistemaFacturacion>/);
  assert.match(xml, /<sf:PrimerRegistro>S<\/sf:PrimerRegistro>/);
  assert.match(xml, /<sf:NombreRazonEmisor>Empresa &lt;Demo&gt;<\/sf:NombreRazonEmisor>/);
  assert.match(xml, /<sf:DescripcionOperacion>Servicio &amp; soporte<\/sf:DescripcionOperacion>/);
  assert.match(xml, /<sf:TipoUsoPosibleSoloVerifactu>S<\/sf:TipoUsoPosibleSoloVerifactu>/);
  assert.match(xml, /<sf:TipoHuella>01<\/sf:TipoHuella>/);
});

test('serializes rectification blocks in exact AEAT XSD order', () => {
  const rectifyingIntent = {
    ...intent,
    invoiceType: 'R1',
    sourceInvoiceId: 'rect-1',
    number: 'R1',
    rectification: {
      type: 'S',
      correctedBaseAmount: '100.00',
      correctedTaxAmount: '21.00',
      correctedSurchargeAmount: '5.20',
      originalInvoices: [{ series: 'A-', number: '0', issueDate: '2026-09-01' }],
    },
    replacedInvoices: [{ series: 'B-', number: '0', issueDate: '2026-09-02' }],
  };
  const rectifyingRecord = {
    ...record,
    invoice: { ...record.invoice, fiscalNumber: 'A-R1' },
    invoiceType: 'R1',
    source: { ...record.source, sourceInvoiceId: 'rect-1' },
  };
  const xml = serializeAeatSoapRequest({ issuer, entries: [{ intent: rectifyingIntent, record: rectifyingRecord }], sif });
  const type = xml.indexOf('<sf:TipoRectificativa>');
  const corrected = xml.indexOf('<sf:FacturasRectificadas>');
  const replaced = xml.indexOf('<sf:FacturasSustituidas>');
  const amounts = xml.indexOf('<sf:ImporteRectificacion>');
  const description = xml.indexOf('<sf:DescripcionOperacion>');
  assert.ok(type < corrected && corrected < replaced && replaced < amounts && amounts < description);
  assert.match(xml, /<sf:CuotaRecargoRectificado>5.20<\/sf:CuotaRecargoRectificado>/);
});

test('serializes previous chain reference on next record', () => {
  const next = {
    ...record,
    sequence: 2,
    invoice: { ...record.invoice, fiscalNumber: 'A-2' },
    firstRecord: false,
    previous: { issuerTaxId: 'B12345678', fiscalNumber: 'A-1', issueDate: '2026-09-15', hash: 'A'.repeat(64) },
    hash: 'B'.repeat(64),
    source: { ...record.source, sourceInvoiceId: 'invoice-2' },
  };
  const nextIntent = { ...intent, number: '2', sourceInvoiceId: 'invoice-2' };
  const xml = serializeAeatSoapRequest({ issuer, entries: [{ intent: nextIntent, record: next }], sif });
  assert.match(xml, /<sf:RegistroAnterior>/);
  assert.match(xml, new RegExp(`<sf:Huella>${'A'.repeat(64)}<\\/sf:Huella>`));
});

test('blocks mixed taxpayers and batches over 1000', () => {
  assert.throws(() => serializeAeatSoapRequest({ issuer, entries: [{ intent, record: { ...record, invoice: { ...record.invoice, issuerTaxId: 'B00000000' } } }], sif }), { code: 'VF_AEAT_BATCH_ISSUER_MISMATCH' });
  assert.throws(() => serializeAeatSoapRequest({ issuer, entries: Array.from({ length: 1001 }, () => ({ intent, record })), sif }), { code: 'VF_AEAT_BATCH_SIZE_INVALID' });
});

test('normalizes accepted, accepted-with-errors and rejected response lines', () => {
  const xml = `<?xml version="1.0"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><r:RespuestaRegFactuSistemaFacturacion xmlns:r="x"><r:CSV>CSV123</r:CSV><r:TiempoEsperaEnvio>60</r:TiempoEsperaEnvio><r:EstadoEnvio>ParcialmenteCorrecto</r:EstadoEnvio><r:RespuestaLinea><r:RefExterna>a</r:RefExterna><r:EstadoRegistro>Correcto</r:EstadoRegistro></r:RespuestaLinea><r:RespuestaLinea><r:RefExterna>b</r:RefExterna><r:EstadoRegistro>AceptadoConErrores</r:EstadoRegistro><r:CodigoErrorRegistro>2001</r:CodigoErrorRegistro></r:RespuestaLinea><r:RespuestaLinea><r:RefExterna>c</r:RefExterna><r:EstadoRegistro>Incorrecto</r:EstadoRegistro><r:CodigoErrorRegistro>3001</r:CodigoErrorRegistro></r:RespuestaLinea></r:RespuestaRegFactuSistemaFacturacion></env:Body></env:Envelope>`;
  const parsed = parseAeatSoapResponse(xml);
  assert.equal(parsed.status, 'partial');
  assert.equal(parsed.waitSeconds, 60);
  assert.deepEqual(parsed.records.map((line) => line.status), ['accepted', 'accepted_with_errors', 'rejected']);
  assert.equal(parsed.needsCorrection, true);
});

test('normalizes SOAP Fault without leaking detail callstack', () => {
  const parsed = parseAeatSoapResponse('<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><env:Fault><faultcode>env:Client</faultcode><faultstring>Codigo[4104]. NIF no identificado</faultstring><detail><callstack>secret-internal</callstack></detail></env:Fault></env:Body></env:Envelope>');
  assert.equal(parsed.kind, 'soap_fault');
  assert.equal(parsed.errorCode, '4104');
  assert.equal(parsed.retryable, true);
  assert.doesNotMatch(JSON.stringify(parsed), /secret-internal/);
});

test('rejects DTD/entity XML', () => {
  assert.throws(() => parseAeatSoapResponse('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>'), { code: 'VF_AEAT_XML_UNSAFE' });
});

test('adapter defaults to official test endpoint and honors TiempoEsperaEnvio', async () => {
  let calledUrl;
  let now = 1000;
  const adapter = new AeatVerifactuAdapter({
    sif,
    clock: () => now,
    transport: async ({ url }) => {
      calledUrl = url;
      return { statusCode: 200, body: '<e><EstadoEnvio>Correcto</EstadoEnvio><TiempoEsperaEnvio>2</TiempoEsperaEnvio><RespuestaLinea><EstadoRegistro>Correcto</EstadoRegistro></RespuestaLinea></e>', headers: {} };
    },
  });
  const result = await adapter.submit({ issuer, entries: [{ intent, record }] });
  assert.equal(calledUrl, AEAT_ENDPOINTS.test);
  assert.equal(result.status, 'accepted');
  await assert.rejects(() => adapter.submit({ issuer, entries: [{ intent, record }] }), { code: 'VF_AEAT_THROTTLED' });
  now = 3000;
  await adapter.submit({ issuer, entries: [{ intent, record }] });
});

test('production endpoint has an explicit safety guard', () => {
  assert.throws(() => new AeatVerifactuAdapter({ sif, environment: 'production', transport: async () => ({}) }), { code: 'VF_AEAT_PRODUCTION_GUARD' });
});

test('outbox retries technical faults but completes business rejection', async () => {
  let now = 0;
  let calls = 0;
  const adapter = {
    submit: async () => {
      calls += 1;
      if (calls === 1) return { kind: 'transport_error', status: 'fault', retryable: true, errorCode: 'ECONNRESET' };
      return { kind: 'aeat_response', status: 'rejected', retryable: false, records: [{ status: 'rejected' }] };
    },
  };
  const outbox = new MemoryAeatOutbox();
  const job = outbox.enqueue({ issuer, entries: [{ intent, record }] }, { availableAt: 0 });
  const worker = new AeatOutboxWorker({ adapter, outbox, clock: () => now, baseBackoffMs: 10 });
  const retried = await worker.run(job.id);
  assert.equal(retried.state, 'pending');
  assert.equal(retried.attempts, 1);
  now = retried.availableAt;
  const completed = await worker.run(job.id);
  assert.equal(completed.state, 'completed');
  assert.equal(completed.attempts, 2);
});
