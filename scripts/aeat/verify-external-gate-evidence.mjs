import { readFile } from 'node:fs/promises';
import {
  parseExternalGateEvidenceOptions,
  verifyAeatExternalGateEvidence,
} from './external-gate-evidence-lib.mjs';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const options = parseExternalGateEvidenceOptions(process.argv.slice(2));
  const [accepted, rejected, reconciliation] = await Promise.all([
    readJson(options.acceptedPath),
    readJson(options.rejectedPath),
    readJson(options.reconciliationPath),
  ]);
  const result = verifyAeatExternalGateEvidence({
    accepted,
    rejected,
    reconciliation,
    sourceCommit: options.sourceCommit,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    gate: 'aeat-test-external-gate-evidence',
    status: 'failed',
    code: error.code ?? 'VF_AEAT_EXTERNAL_GATE_INTERNAL',
    message: error.message,
    field: error.field ?? null,
  }, null, 2));
  process.exitCode = 1;
});
