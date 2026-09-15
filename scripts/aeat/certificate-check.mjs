import { loadPfxCredentials } from './certificate-preflight-lib.mjs';

async function main() {
  const { summary } = await loadPfxCredentials(process.env);
  console.log(JSON.stringify({
    gate: 'aeat-certificate-preflight',
    ...summary,
    note: 'This check does not contact AEAT and does not prove certificate authorization, scope, expiry or taxpayer correspondence.',
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    gate: 'aeat-certificate-preflight',
    status: 'failed',
    code: error.code ?? 'VF_AEAT_GATE_INTERNAL',
    message: error.message,
  }, null, 2));
  process.exitCode = 1;
});
