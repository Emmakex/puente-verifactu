import { existsSync, readFileSync } from 'node:fs';

const contracts = [
  {
    path: 'docs/runbooks/README.md',
    markers: ['kairoseth-hostinger-mongodb', 'mode=kairoseth-mongodb', 'SQLite `standalone`', 'reconciliation_required', 'deploy-rollback.md', 'backup-restore.md', 'credential-rotation.md', 'pilot-progressive.md'],
  },
  {
    path: 'docs/runbooks/deploy-rollback.md',
    markers: ['kairoseth-hostinger-mongodb', 'mode = kairoseth-mongodb', '/healthz', '/readyz', '/v1/ops/status', 'No restaurar automáticamente MongoDB'],
  },
  {
    path: 'docs/runbooks/aeat-incident-reconciliation.md',
    markers: [
      'VF_OBS_AEAT_RECONCILIATION_REQUIRED',
      'reconciliation_required',
      'Nunca convertir automáticamente',
      'npm run aeat:reconcile',
      'SinDatos',
      'AEAT_RECONCILIATION_APPLY',
      'AEAT_RECONCILIATION_SEED',
      '--reconciliation-seed-db',
      'cero submits',
    ],
  },
  {
    path: 'docs/runbooks/backup-restore.md',
    markers: ['npm run sqlite:backup', 'npm run sqlite:verify-backup', 'npm run sqlite:restore', '--offline-confirmation', 'no reemitirlas automáticamente'],
  },
  {
    path: 'docs/runbooks/credential-rotation.md',
    markers: ['npm run auth:hash', 'ops:read', 'recibe 401', 'no reactivarla'],
  },
  {
    path: 'docs/runbooks/pilot-progressive.md',
    markers: [
      'npm run pilot:readiness',
      'candidate_evidence_complete',
      'reconciliation_required',
      'code-first-no-automatic-db-restore',
      'stop_on_warning',
      'approval-v0.1.0.json',
      'kairoseth-hostinger-mongodb',
      'kairoseth-mongodb',
      'kairoseth-managed-backup-readiness',
    ],
  },
];

const failures = [];

for (const contract of contracts) {
  if (!existsSync(contract.path)) {
    failures.push({ code: 'RUNBOOK_MISSING', path: contract.path });
    continue;
  }
  const content = readFileSync(contract.path, 'utf8');
  for (const marker of contract.markers) {
    if (!content.includes(marker)) failures.push({ code: 'RUNBOOK_MARKER_MISSING', path: contract.path, marker });
  }
}

const deployRunbook = readFileSync('docs/runbooks/deploy-rollback.md', 'utf8');
for (const forbidden of ['PV_DATABASE_PATH', 'sqlite:backup -- --db', 'sqlite:verify-backup -- --backup']) {
  if (deployRunbook.includes(forbidden)) {
    failures.push({
      code: 'RUNBOOK_KAIROSETH_SQLITE_LEAK',
      path: 'docs/runbooks/deploy-rollback.md',
      marker: forbidden,
    });
  }
}

const productionReadiness = existsSync('docs/production-readiness.md')
  ? readFileSync('docs/production-readiness.md', 'utf8')
  : '';
for (const marker of ['### 6.4 Runbooks operativos', 'docs/runbooks/README.md', 'deploy/rollback', 'rotación de credenciales']) {
  if (!productionReadiness.includes(marker)) failures.push({ code: 'RUNBOOK_READINESS_DOC_INCOMPLETE', marker });
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    check: 'production-runbooks',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'production-runbooks',
  runbooks: contracts.length,
}, null, 2));
