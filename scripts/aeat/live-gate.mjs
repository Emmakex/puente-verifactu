import { readFile } from 'node:fs/promises';
import { AeatVerifactuAdapter } from '../../packages/aeat-adapter/src/adapter.mjs';
import { serializeAeatSoapRequest } from '../../packages/aeat-adapter/src/serialize.mjs';
import { createHttpsMtlsTransport } from '../../packages/aeat-adapter/src/transport.mjs';
import { assertLiveSendAllowed, buildLiveGateFixture, buildLiveGateSummary } from './live-gate-lib.mjs';

function sanitizeResult(result) {
  return {
    kind: result?.kind ?? null,
    status: result?.status ?? null,
    csv: result?.csv ?? null,
    waitSeconds: result?.waitSeconds ?? null,
    errorCode: result?.errorCode ?? null,
    message: result?.message ?? null,
    records: (result?.records ?? []).map((item) => ({
      reference: item.reference ?? null,
      status: item.status ?? null,
      errorCode: item.errorCode ?? null,
      errorDescription: item.errorDescription ?? null,
    })),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const send = assertLiveSendAllowed(argv, process.env);
  const fixture = buildLiveGateFixture(process.env, new Date());
  const entries = [{ intent: fixture.intent, record: fixture.record }];
  const xml = serializeAeatSoapRequest({ issuer: fixture.issuer, entries, sif: fixture.sif });
  const summary = buildLiveGateSummary(fixture, xml);

  console.log(JSON.stringify({
    gate: 'aeat-test-live',
    action: send ? 'submit' : 'dry-run',
    summary,
  }, null, 2));

  if (argv.includes('--show-xml')) {
    console.log(xml);
  }

  if (!send) {
    console.log('Dry-run only. To submit, provision the certificate locally and run with --send plus AEAT_LIVE_SEND=YES.');
    return;
  }

  const pfxPath = String(process.env.AEAT_TEST_PFX_PATH ?? '').trim();
  if (!pfxPath) {
    const error = new Error('AEAT_TEST_PFX_PATH is required for live submission');
    error.code = 'VF_AEAT_GATE_PFX_PATH_REQUIRED';
    throw error;
  }

  const pfx = await readFile(pfxPath);
  const transport = createHttpsMtlsTransport({
    tls: {
      pfx,
      passphrase: process.env.AEAT_TEST_PFX_PASSPHRASE,
    },
  });
  const adapter = new AeatVerifactuAdapter({
    sif: fixture.sif,
    environment: 'test',
    transport,
  });

  const result = await adapter.submit({ issuer: fixture.issuer, entries });
  const sanitized = sanitizeResult(result);
  console.log(JSON.stringify({ gate: 'aeat-test-live-result', result: sanitized }, null, 2));

  if (result?.status !== 'accepted') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    gate: 'aeat-test-live',
    status: 'failed',
    code: error.code ?? 'VF_AEAT_GATE_INTERNAL',
    message: error.message,
    field: error.field ?? null,
  }, null, 2));
  process.exitCode = 1;
});
