import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AeatVerifactuAdapter } from '../../packages/aeat-adapter/src/adapter.mjs';
import { serializeAeatSoapRequest } from '../../packages/aeat-adapter/src/serialize.mjs';
import { createHttpsMtlsTransport } from '../../packages/aeat-adapter/src/transport.mjs';
import { loadPfxCredentials } from './certificate-preflight-lib.mjs';
import {
  assertControlledReconciliationSeedDestinations,
  createControlledReconciliationSeed,
  releaseControlledReconciliationSeedReservations,
} from './reconciliation-seed-lib.mjs';
import {
  buildLiveGateEvidence,
  buildLiveGateFixture,
  buildLiveGateSummary,
  parseLiveGateOptions,
  sanitizeLiveGateResult,
} from './live-gate-lib.mjs';

async function writeEvidence(path, evidence) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const options = parseLiveGateOptions(argv, process.env);
  const fixture = buildLiveGateFixture(process.env, new Date());
  const entries = [{ intent: fixture.intent, record: fixture.record }];
  const requestPayload = { issuer: fixture.issuer, entries };
  const xml = serializeAeatSoapRequest({ ...requestPayload, sif: fixture.sif });
  const summary = buildLiveGateSummary(fixture, xml);
  const action = options.send ? 'submit' : 'dry-run';

  console.log(JSON.stringify({
    gate: 'aeat-test-live',
    action,
    expectedStatus: options.expectedStatus,
    summary,
  }, null, 2));

  if (options.showXml) {
    console.log(xml);
  }

  if (!options.send) {
    if (options.evidenceOutput) {
      await writeEvidence(options.evidenceOutput, buildLiveGateEvidence({
        action,
        expectedStatus: options.expectedStatus,
        sourceCommit: options.sourceCommit,
        summary,
      }));
    }
    console.log('Dry-run only. To submit, provision the certificate locally and run with --send plus AEAT_LIVE_SEND=YES.');
    return;
  }

  let seedReservations = null;
  let seedCreationStarted = false;
  if (options.reconciliationSeedDb) {
    seedReservations = await assertControlledReconciliationSeedDestinations({
      databasePath: options.reconciliationSeedDb,
      operatorOutputPath: options.reconciliationSeedOutput,
    });
  }

  try {
    const { pfx, passphrase } = await loadPfxCredentials(process.env);
    const transport = createHttpsMtlsTransport({
      tls: { pfx, passphrase },
    });
    const adapter = new AeatVerifactuAdapter({
      sif: fixture.sif,
      environment: 'test',
      transport,
    });

    const result = await adapter.submit(requestPayload);
    const sanitized = sanitizeLiveGateResult(result);
    console.log(JSON.stringify({ gate: 'aeat-test-live-result', result: sanitized }, null, 2));

    if (options.evidenceOutput) {
      await writeEvidence(options.evidenceOutput, buildLiveGateEvidence({
        action,
        expectedStatus: options.expectedStatus,
        sourceCommit: options.sourceCommit,
        summary,
        result: sanitized,
      }));
    }

    if (options.expectedStatus && result?.status !== options.expectedStatus) {
      const error = new Error(`Expected AEAT status ${options.expectedStatus}, got ${result?.status ?? 'unknown'}`);
      error.code = 'VF_AEAT_GATE_UNEXPECTED_STATUS';
      throw error;
    }

    if (seedReservations) {
      seedCreationStarted = true;
      const seed = await createControlledReconciliationSeed({
        databasePath: seedReservations.databasePath,
        operatorOutputPath: seedReservations.operatorOutputPath,
        payload: requestPayload,
        sourceCommit: options.sourceCommit,
        liveResult: result,
        recordedAt: new Date(),
        reservationsAlreadyHeld: true,
      });
      console.log(JSON.stringify({
        gate: 'aeat-controlled-reconciliation-seed',
        result: seed,
      }, null, 2));
      console.log('Private reconciliation seed created. Read the private operator output file locally for the job ID, then run npm run aeat:reconcile in inspect mode.');
    }
  } finally {
    if (seedReservations && !seedCreationStarted) {
      await releaseControlledReconciliationSeedReservations(seedReservations);
    }
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
