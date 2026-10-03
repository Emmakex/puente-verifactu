import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFACTU_QR_SPECIFICATION,
  buildVerifactuInvoicePresentation,
  buildVerifactuQrUrl,
} from '../src/verifactu-presentation.mjs';

test('builds official VERI*FACTU test QR URL fixture', () => {
  assert.equal(
    buildVerifactuQrUrl({
      environment: 'test',
      issuerTaxId: '89890001K',
      invoiceNumber: '12345678-G33',
      issueDate: '2024-09-01',
      totalAmount: '241.4',
    }),
    'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=12345678-G33&fecha=01-09-2024&importe=241.4',
  );
});

test('encodes special invoice-number characters deterministically', () => {
  const url = buildVerifactuQrUrl({
    environment: 'test',
    issuerTaxId: '89890001K',
    invoiceNumber: '12345678&G33',
    issueDate: '2024-01-01',
    totalAmount: '241.4',
  });

  assert.equal(
    url,
    'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=12345678%26G33&fecha=01-01-2024&importe=241.4',
  );
});

test('uses production endpoint and optional supported language only', () => {
  const url = buildVerifactuQrUrl({
    environment: 'production',
    issuerTaxId: '89890001K',
    invoiceNumber: 'VF-2026-0001',
    issueDate: '2026-10-03',
    totalAmount: '121.00',
    language: 'ca',
  });
  assert.equal(
    url,
    'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=89890001K&numserie=VF-2026-0001&fecha=03-10-2026&importe=121.00&idioma=ca',
  );
  assert.throws(() => buildVerifactuQrUrl({
    environment: 'production',
    issuerTaxId: '89890001K',
    invoiceNumber: 'VF-1',
    issueDate: '2026-10-03',
    totalAmount: '1.00',
    language: 'fr',
  }), /language/);
});

test('presentation contract fixes required QR and VERI*FACTU texts', () => {
  const presentation = buildVerifactuInvoicePresentation({
    environment: 'test',
    issuerTaxId: '89890001K',
    invoiceNumber: 'VF-1',
    issueDate: '2026-10-03',
    totalAmount: '1.00',
  });

  assert.equal(presentation.mode, 'VERI*FACTU');
  assert.equal(presentation.qr.prefixText, 'QR tributario:');
  assert.equal(presentation.verificationText, 'Factura verificable en la sede electrónica de la AEAT');
  assert.equal(presentation.qr.errorCorrection, 'M');
  assert.equal(presentation.qr.minSizeMm, 30);
  assert.equal(presentation.qr.maxSizeMm, 40);
  assert.equal(presentation.qr.minQuietZoneMm, 2);
  assert.equal(presentation.qr.recommendedQuietZoneMm, 6);
  assert.equal(presentation.structuredInvoice.verificationUrlFieldRequired, true);
  assert.equal(presentation.specificationVersion, '0.5.0');
  assert.equal(VERIFACTU_QR_SPECIFICATION.publishedAt, '2025-12-10');
});

test('rejects malformed QR inputs before presentation', () => {
  const base = {
    environment: 'test',
    issuerTaxId: '89890001K',
    invoiceNumber: 'VF-1',
    issueDate: '2026-10-03',
    totalAmount: '1.00',
  };

  assert.throws(() => buildVerifactuQrUrl({ ...base, environment: 'staging' }), /environment/);
  assert.throws(() => buildVerifactuQrUrl({ ...base, issuerTaxId: 'SHORT' }), /9 characters/);
  assert.throws(() => buildVerifactuQrUrl({ ...base, invoiceNumber: 'ñ' }), /ASCII/);
  assert.throws(() => buildVerifactuQrUrl({ ...base, issueDate: '2026-02-30' }), /valid calendar date/);
  assert.throws(() => buildVerifactuQrUrl({ ...base, totalAmount: '1.234' }), /decimal string/);
});
