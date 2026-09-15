import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAltaHash, calculateAnulacionHash, timestampForZone } from '../src/hash.mjs';
import { createAltaFiscalRecord } from '../src/fiscal-records.mjs';
import { FiscalRecordService, verifyFiscalChain } from '../src/fiscal-record-service.mjs';

const officialFirstHash = '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60';
const officialSecondHash = 'F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97';

test('AEAT official fixture: first alta hash', () => {
  assert.equal(calculateAltaHash({
    issuerTaxId: '89890001K',
    fiscalNumber: '12345678/G33',
    issueDate: '2024-01-01',
    invoiceType: 'F1',
    quotaTotal: '12.35',
    totalAmount: '123.45',
    previousHash: '',
    generatedAt: '2024-01-01T19:20:30+01:00',
  }), officialFirstHash);
});

test('AEAT official fixture: chained alta hash', () => {
  assert.equal(calculateAltaHash({
    issuerTaxId: '89890001K',
    fiscalNumber: '12345679/G34',
    issueDate: '2024-01-01',
    invoiceType: 'F1',
    quotaTotal: '12.35',
    totalAmount: '123.45',
    previousHash: officialFirstHash,
    generatedAt: '2024-01-01T19:20:35+01:00',
  }), officialSecondHash);
});

test('AEAT official fixture: chained anulacion hash', () => {
  assert.equal(calculateAnulacionHash({
    issuerTaxId: '89890001K',
    fiscalNumber: '12345679/G34',
    issueDate: '2024-01-01',
    previousHash: officialSecondHash,
    generatedAt: '2024-01-01T19:20:40+01:00',
  }), '177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68');
});

function intent(id, number) {
  return {
    schemaVersion: 1,
    operation: 'issue',
    organizationId: 'org-1',
    installationId: 'source-1',
    sourceSystem: 'csv',
    sourceInvoiceId: id,
    series: '',
    number,
    issueDate: '2026-09-15',
    invoiceType: 'F1',
    description: 'Servicio',
    issuer: { name: 'Emisor SL', taxId: 'B12345678' },
    recipients: [{ name: 'Cliente SL', taxId: 'B87654321' }],
    currency: 'EUR',
    taxBreakdown: [{ taxCode: '01', regimeKey: '01', operationClass: 'S1', baseAmount: '100.00', taxAmount: '21.00' }],
    adjustments: [],
    totals: { baseAmount: '100.00', taxAmount: '21.00', totalAmount: '121.00' },
  };
}

test('service chains issue + cancellation in one SIF chain', async () => {
  const service = new FiscalRecordService({ sif: { systemId: 'PV', installationNumber: '001' } });
  const issued = await service.issue(intent('a', 'A-1'), { generatedAt: '2026-09-15T10:00:00+02:00' });
  const cancelled = await service.cancel({
    organizationId: 'org-1',
    sourceCancellationId: 'cancel-a',
    issuerTaxId: 'B12345678',
    number: 'A-1',
    issueDate: '2026-09-15',
  }, { generatedAt: '2026-09-15T10:00:01+02:00' });
  assert.equal(cancelled.record.previous.hash, issued.record.hash);
  assert.equal(cancelled.record.sequence, 2);
  assert.equal(verifyFiscalChain(service.store.list(issued.record.chainKey)).ok, true);
});

test('issue is idempotent and content conflict is rejected', async () => {
  const service = new FiscalRecordService({ sif: { systemId: 'PV', installationNumber: '001' } });
  const base = intent('same', 'S-1');
  const one = await service.issue(base, { generatedAt: '2026-09-15T10:00:00+02:00' });
  const two = await service.issue(base, { generatedAt: '2026-09-15T10:05:00+02:00' });
  assert.equal(two.duplicate, true);
  assert.equal(two.record.hash, one.record.hash);
  await assert.rejects(() => service.issue({
    ...base,
    totals: { ...base.totals, totalAmount: '122.00' },
  }, { generatedAt: '2026-09-15T10:06:00+02:00' }), { code: 'VF_FISCAL_IDEMPOTENCY_CONFLICT' });
});

test('parallel issues are serialized into one chain', async () => {
  const service = new FiscalRecordService({ sif: { systemId: 'PV', installationNumber: '001' } });
  const [a, b] = await Promise.all([
    service.issue(intent('parallel-a', 'P-1'), { generatedAt: '2026-09-15T10:00:00+02:00' }),
    service.issue(intent('parallel-b', 'P-2'), { generatedAt: '2026-09-15T10:00:00+02:00' }),
  ]);
  const records = service.store.list(a.record.chainKey);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.sequence), [1, 2]);
  assert.equal(records[1].previous.hash, records[0].hash);
  assert.equal(new Set([a.record.hash, b.record.hash]).size, 2);
});

test('non-EUR fiscalization requires explicit EUR values', () => {
  const nonEuro = { ...intent('usd', 'USD-1'), currency: 'USD' };
  assert.throws(() => createAltaFiscalRecord(nonEuro, {
    sif: { systemId: 'PV', installationNumber: '001' },
    generatedAt: '2026-09-15T10:00:00+02:00',
  }), { code: 'VF_FISCAL_EUR_CONVERSION_REQUIRED' });
});

test('timestamp helper applies configured IANA zone', () => {
  assert.equal(timestampForZone(new Date('2026-09-15T08:00:00Z'), 'Europe/Madrid'), '2026-09-15T10:00:00+02:00');
});

test('numeric trailing zeros do not change AEAT hash', () => {
  assert.equal(calculateAltaHash({
    issuerTaxId: '89890001K',
    fiscalNumber: '12345678/G33',
    issueDate: '2024-01-01',
    invoiceType: 'F1',
    quotaTotal: '12.3500',
    totalAmount: '123.450',
    previousHash: '',
    generatedAt: '2024-01-01T19:20:30+01:00',
  }), officialFirstHash);
});
