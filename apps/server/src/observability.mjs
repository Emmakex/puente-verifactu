import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_THRESHOLDS = Object.freeze({
  pendingWarningMs: 5 * 60 * 1000,
  pendingCriticalMs: 15 * 60 * 1000,
  backupWarningMs: 26 * 60 * 60 * 1000,
  backupCriticalMs: 50 * 60 * 60 * 1000,
});

const EMPTY_OUTBOX = Object.freeze({
  available: false,
  total: null,
  pending: null,
  processing: null,
  reconciliationRequired: null,
  completed: null,
  blocked: null,
  duePending: null,
  expiredProcessing: null,
  oldestPendingAt: null,
  oldestPendingAgeMs: null,
  oldestReconciliationAt: null,
  oldestReconciliationAgeMs: null,
});

function validThreshold(value, fallback, name) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function normalizeThresholds(input = {}) {
  const thresholds = {
    pendingWarningMs: validThreshold(input.pendingWarningMs, DEFAULT_THRESHOLDS.pendingWarningMs, 'pendingWarningMs'),
    pendingCriticalMs: validThreshold(input.pendingCriticalMs, DEFAULT_THRESHOLDS.pendingCriticalMs, 'pendingCriticalMs'),
    backupWarningMs: validThreshold(input.backupWarningMs, DEFAULT_THRESHOLDS.backupWarningMs, 'backupWarningMs'),
    backupCriticalMs: validThreshold(input.backupCriticalMs, DEFAULT_THRESHOLDS.backupCriticalMs, 'backupCriticalMs'),
  };
  if (thresholds.pendingCriticalMs <= thresholds.pendingWarningMs) throw new TypeError('pendingCriticalMs must be greater than pendingWarningMs');
  if (thresholds.backupCriticalMs <= thresholds.backupWarningMs) throw new TypeError('backupCriticalMs must be greater than backupWarningMs');
  return Object.freeze(thresholds);
}

function alert(code, severity, message, details = {}) {
  return Object.freeze({ code, severity, message, details: Object.freeze({ ...details }) });
}

function backupStatus(manifestPath, now) {
  if (!manifestPath) {
    return Object.freeze({ configured: false, status: 'unconfigured', createdAt: null, ageMs: null });
  }
  if (!existsSync(manifestPath)) {
    return Object.freeze({ configured: true, status: 'missing', createdAt: null, ageMs: null });
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest?.kind !== 'puente-sqlite-backup' || manifest?.schema_version !== 1 || typeof manifest?.created_at !== 'string') {
      return Object.freeze({ configured: true, status: 'invalid_manifest', createdAt: null, ageMs: null });
    }
    const createdMs = Date.parse(manifest.created_at);
    if (!Number.isFinite(createdMs)) return Object.freeze({ configured: true, status: 'invalid_manifest', createdAt: null, ageMs: null });
    return Object.freeze({
      configured: true,
      status: 'ok',
      createdAt: new Date(createdMs).toISOString(),
      ageMs: Math.max(0, now - createdMs),
    });
  } catch {
    return Object.freeze({ configured: true, status: 'invalid_manifest', createdAt: null, ageMs: null });
  }
}

function databaseStatus(database) {
  try {
    const row = database.db.prepare('SELECT 1 AS ok').get();
    return Object.freeze({ ok: row?.ok === 1 });
  } catch {
    return Object.freeze({ ok: false });
  }
}

function outboxStatus(outbox, now) {
  try {
    return Object.freeze({ available: true, ...outbox.stats(now) });
  } catch {
    return EMPTY_OUTBOX;
  }
}

function deriveAlerts({ database, outbox, backup }, thresholds) {
  const alerts = [];
  if (!database.ok) alerts.push(alert('VF_OBS_DATABASE_UNAVAILABLE', 'critical', 'SQLite is not available'));
  if (!outbox.available) {
    alerts.push(alert('VF_OBS_AEAT_OUTBOX_UNAVAILABLE', 'critical', 'AEAT outbox metrics are not available'));
  } else {
    if (outbox.reconciliationRequired > 0) {
      alerts.push(alert(
        'VF_OBS_AEAT_RECONCILIATION_REQUIRED',
        'critical',
        'AEAT operations require explicit reconciliation',
        { count: outbox.reconciliationRequired },
      ));
    }
    if (outbox.blocked > 0) {
      alerts.push(alert('VF_OBS_AEAT_OUTBOX_BLOCKED', 'critical', 'AEAT outbox contains blocked operations', { count: outbox.blocked }));
    }
    if (outbox.expiredProcessing > 0) {
      alerts.push(alert('VF_OBS_AEAT_LEASE_EXPIRED', 'critical', 'AEAT processing leases are expired', { count: outbox.expiredProcessing }));
    }
    if (outbox.oldestPendingAgeMs != null && outbox.oldestPendingAgeMs >= thresholds.pendingCriticalMs) {
      alerts.push(alert('VF_OBS_AEAT_PENDING_AGE_CRITICAL', 'critical', 'Oldest pending AEAT operation exceeds critical age', {
        ageMs: outbox.oldestPendingAgeMs,
        thresholdMs: thresholds.pendingCriticalMs,
      }));
    } else if (outbox.oldestPendingAgeMs != null && outbox.oldestPendingAgeMs >= thresholds.pendingWarningMs) {
      alerts.push(alert('VF_OBS_AEAT_PENDING_AGE_WARNING', 'warning', 'Oldest pending AEAT operation exceeds warning age', {
        ageMs: outbox.oldestPendingAgeMs,
        thresholdMs: thresholds.pendingWarningMs,
      }));
    }
  }

  if (!backup.configured) {
    alerts.push(alert('VF_OBS_BACKUP_MONITORING_UNCONFIGURED', 'warning', 'Backup manifest monitoring is not configured'));
  } else if (backup.status !== 'ok') {
    alerts.push(alert('VF_OBS_BACKUP_MANIFEST_INVALID', 'critical', 'Backup manifest is missing or invalid', { status: backup.status }));
  } else if (backup.ageMs >= thresholds.backupCriticalMs) {
    alerts.push(alert('VF_OBS_BACKUP_AGE_CRITICAL', 'critical', 'Latest backup exceeds critical age', {
      ageMs: backup.ageMs,
      thresholdMs: thresholds.backupCriticalMs,
    }));
  } else if (backup.ageMs >= thresholds.backupWarningMs) {
    alerts.push(alert('VF_OBS_BACKUP_AGE_WARNING', 'warning', 'Latest backup exceeds warning age', {
      ageMs: backup.ageMs,
      thresholdMs: thresholds.backupWarningMs,
    }));
  }

  return Object.freeze(alerts);
}

export function createOperationalObserver({
  persistence,
  backupManifestPath = null,
  clock = () => Date.now(),
  thresholds: thresholdInput = {},
} = {}) {
  if (!persistence?.database || !persistence?.aeatOutbox || typeof persistence.aeatOutbox.stats !== 'function') {
    throw new TypeError('persistence with database and aeatOutbox.stats() is required');
  }
  const thresholds = normalizeThresholds(thresholdInput);

  return Object.freeze({
    snapshot() {
      const now = Number(clock());
      if (!Number.isFinite(now)) throw new TypeError('observability clock must return epoch milliseconds');
      const database = databaseStatus(persistence.database);
      const outbox = outboxStatus(persistence.aeatOutbox, now);
      const backup = backupStatus(backupManifestPath, now);
      const alerts = deriveAlerts({ database, outbox, backup }, thresholds);
      const critical = alerts.filter((item) => item.severity === 'critical').length;
      const warning = alerts.filter((item) => item.severity === 'warning').length;
      return Object.freeze({
        schemaVersion: 1,
        generatedAt: new Date(now).toISOString(),
        mode: 'single-node-sqlite',
        database,
        aeatOutbox: outbox,
        backup,
        alerts,
        summary: Object.freeze({
          status: critical > 0 ? 'critical' : warning > 0 ? 'warning' : 'ok',
          critical,
          warning,
        }),
      });
    },
  });
}
