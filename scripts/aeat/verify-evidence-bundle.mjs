import { readFile } from 'node:fs/promises';
import {
  parseEvidenceVerifierOptions,
  verifyAeatEvidenceBundle,
} from './evidence-bundle-verifier-lib.mjs';

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    const error = new Error(`${label} evidence file cannot be read`);
    error.code = 'VF_AEAT_EVIDENCE_FILE_UNREADABLE';
    error.field = label;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error(`${label} evidence file is not valid JSON`);
    error.code = 'VF_AEAT_EVIDENCE_JSON_INVALID';
    error.field = label;
    throw error;
  }
}

async function main() {
  const options = parseEvidenceVerifierOptions(process.argv.slice(2));
  const [accepted, rejected] = await Promise.all([
    readJson(options.acceptedPath, 'accepted'),
    readJson(options.rejectedPath, 'rejected'),
  ]);
  const result = verifyAeatEvidenceBundle({
    accepted,
    rejected,
    sourceCommit: options.sourceCommit,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    gate: 'aeat-test-live-evidence-bundle',
    status: 'failed',
    code: error.code ?? 'VF_AEAT_EVIDENCE_INTERNAL',
    message: error.message,
    field: error.field ?? null,
    releaseUnblocked: false,
  }, null, 2));
  process.exitCode = 1;
});
