import { createSecureContext } from 'node:tls';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AeatVerifactuAdapter } from '../../packages/aeat-adapter/src/adapter.mjs';
import { serializeAeatSoapRequest } from '../../packages/aeat-adapter/src/serialize.mjs';
import { createHttpsMtlsTransport } from '../../packages/aeat-adapter/src/transport.mjs';
import {
  buildLiveGateEvidence,
  buildLiveGateFixture,
  buildLiveGateSummary,
  parseLiveGateOptions,
  sanitizeLiveGateResult,
} from './live-gate-lib.mjs';

async function resolvePfxPassphrase(env) {
  const direct = env.AEAT_TEST_PFX_PASSPHRASE;
  const secretPath = String(env.AEAT_TEST_PFX_PASSPHRASE_FILE ?? '').trim();
  if (direct != null && secretPath) {
    const error = new Error('Configure only one PFX passphrase source');
    error.code = 'VF_AEAT_GATE_PFX_PASSPHRASE_AMBIGUOUS';
    throw error;
  }
  if (!secretPath) return direct;
  const secret = await readFile(secretPath, 'utf8');
  return secret.replace(/\r?\n$/, '');
}

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
  const xml = serializeAeatSoapRequest({ issuer: fixture.issuer, entries, sif: fixture.sif });
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

  const pfxPath = String(process.env.AEAT_TEST_PFX_PATH ?? '').trim();
  if (!pfxPath) {
    const error = new Error('AEAT_TEST_PFX_PATH is required for live submission');
    error.code = 'VF_AEAT_GATE_PFX_PATH_REQUIRED';
    throw error;
  }

  const pfx = await readFile(pfxPath);
  const passphrase = await resolvePfxPassphrase(process.env);
  try {
    createSecureContext({ pfx, passphrase });
  } catch {
    const error = new Error('The configured PFX cannot be opened with the supplied passphrase');
    error.code = 'VF_AEAT_GATE_PFX_INVALID';
    throw error;
  }

  const transport = createHttpsMtlsTransport({
    tls: { pfx, passphrase },
  });
  const adapter = new AeatVerifactuAdapter({
    sif: fixture.sif,
    environment: 'test',
    transport,
  });

  const result = await adapter.submit({ issuer: fixture.issuer, entries });
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
