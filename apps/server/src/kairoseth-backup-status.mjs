import { readFile } from 'node:fs/promises';

const PROFILE = 'kairoseth-hostinger-mongodb';
const KIND = 'kairoseth-managed-backup-readiness';

function invalidStatus(status = 'invalid_manifest') {
  return Object.freeze({
    configured: true,
    status,
    createdAt: null,
    ageMs: null,
  });
}

export function createKairosethBackupStatusProvider({ reportPath } = {}) {
  const path = String(reportPath ?? '').trim();

  return async function backupStatus(now = Date.now()) {
    if (!path) {
      return Object.freeze({
        configured: false,
        status: 'unconfigured',
        createdAt: null,
        ageMs: null,
      });
    }

    let report;
    try {
      report = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return invalidStatus('missing');
    }

    if (
      report?.schemaVersion !== 1
      || report?.kind !== KIND
      || report?.deploymentProfile !== PROFILE
      || report?.status !== 'ok'
      || report?.containsSecrets !== false
      || report?.containsFiscalData !== false
      || report?.newestBackup?.remote !== true
      || report?.newestBackup?.encryptedAtRest !== true
      || report?.restoreDrill?.result !== 'ok'
      || report?.restoreDrill?.backupSha256 !== report?.newestBackup?.sha256
      || !/^[a-f0-9]{64}$/i.test(String(report?.newestBackup?.sha256 ?? ''))
    ) {
      return invalidStatus();
    }

    const createdMs = Date.parse(String(report.newestBackup.createdAt ?? ''));
    if (!Number.isFinite(createdMs)) return invalidStatus();

    return Object.freeze({
      configured: true,
      status: 'ok',
      createdAt: new Date(createdMs).toISOString(),
      ageMs: Math.max(0, Number(now) - createdMs),
      provider: String(report.provider ?? '').slice(0, 256),
    });
  };
}
