import { runLiveReconciliation } from './live-reconciliation-lib.mjs';

async function main() {
  const evidence = await runLiveReconciliation();
  console.log(JSON.stringify(evidence, null, 2));

  if (evidence.mode === 'inspect' && evidence.assessment.allReceived) {
    console.log('AEAT confirms an exact match. Re-run with --apply plus AEAT_RECONCILIATION_APPLY=YES only if you want to persist completion of this quarantined job.');
  } else if (!evidence.assessment.allReceived) {
    console.log('Reconciliation remains unresolved. The job stays quarantined and must not be reissued automatically.');
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    gate: 'aeat-official-reconciliation-live',
    status: 'failed',
    code: error.code ?? 'VF_AEAT_RECONCILIATION_INTERNAL',
    message: error.message,
    field: error.field ?? null,
  }, null, 2));
  process.exitCode = 1;
});
