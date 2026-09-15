import test from 'node:test';
import assert from 'node:assert/strict';
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
  installationId: 'shop',
  sourceSystem: 'csv',
  sourceInvoiceId: 'retail-1',
  series: 'R-',
  number: '1',
  issueDate: '2026-09-15',
  invoiceType: 'F1',
  description: 'Venta con recargo',
  issuer: { name: 'Proveedor SL', taxId: 'B12345678' },
  recipients: [{ name: 'Comercio SL', taxId: 'B87654321' }],
  currency: 'EUR',
  taxBreakdown: [{ taxCode: '01', regimeKey: '01', operationClass: 'S1', rate: '21', baseAmount: '100.00', taxAmount: '21.00', surchargeRate: '5.2', surchargeAmount: '5.20' }],
  adjustments: [],
  totals: { baseAmount: '100.00', taxAmount: '21.00', totalAmount: '126.20' },
};

const record = {
  schemaVersion: 1,
  recordType: 'alta',
  sequence: 1,
  organizationId: 'org-1',
  chainKey: 'org-1\u001fPV\u001f001',
  sif: { systemId: 'PV', installationNumber: '001' },
  invoice: { issuerTaxId: 'B12345678', fiscalNumber: 'R-1', issueDate: '2026-09-15' },
  invoiceType: 'F1',
  quotaTotal: '26.20',
  totalAmount: '126.20',
  firstRecord: true,
  previous: null,
  generatedAt: '2026-09-15T10:00:00+02:00',
  hashType: '01',
  hash: 'C'.repeat(64),
  source: { installationId: 'shop', sourceSystem: 'csv', sourceInvoiceId: 'retail-1' },
};

test('recargo de equivalencia is emitted in DetalleDesglose', () => {
  const xml = serializeAeatSoapRequest({ issuer: intent.issuer, entries: [{ intent, record }], sif });
  assert.match(xml, /<sf:TipoRecargoEquivalencia>5\.2<\/sf:TipoRecargoEquivalencia>/);
  assert.match(xml, /<sf:CuotaRecargoEquivalencia>5\.20<\/sf:CuotaRecargoEquivalencia>/);
  assert.match(xml, /<sf:CuotaTotal>26\.20<\/sf:CuotaTotal>/);
});
