# Evidencia de backup gestionado — Kairoseth / MongoDB

Este contrato aplica al perfil productivo `kairoseth-hostinger-mongodb`.
El runtime de Puente VeriFactu no gestiona directamente credenciales, snapshots ni
restores del MongoDB productivo: Kairoseth inyecta el estado de backup y conserva
la operación del proveedor dentro de su infraestructura.

## Objetivo

Antes de abrir un piloto fiscal real deben existir dos evidencias distintas:

1. `/v1/ops/status` debe informar `backup.configured=true` y
   `backup.status=ok`;
2. debe existir un recibo privado de backup gestionado que demuestre backup
   reciente, cifrado en reposo y un restore drill reciente.

Ninguna de las dos evidencias contiene URI MongoDB, usuario, password, token,
clave del proveedor, URL firmada ni datos fiscales.

## Contrato

Referencia: `config/kairoseth-backup-evidence.example.json`.

```json
{
  "schemaVersion": 1,
  "kind": "kairoseth-managed-mongodb-backup-evidence",
  "deploymentProfile": "kairoseth-hostinger-mongodb",
  "status": "ok",
  "provider": "kairoseth-managed-mongodb-backup",
  "backup": {
    "createdAt": "2026-10-04T08:00:00.000Z",
    "encryptedAtRest": true,
    "reference": "backup-ref-example"
  },
  "restoreDrill": {
    "performedAt": "2026-10-04T09:00:00.000Z",
    "status": "ok",
    "reference": "restore-drill-ref-example"
  }
}
```

`reference` es deliberadamente opaco. No debe ser una URL firmada ni incluir
query strings con tokens, firmas, claves o passwords.

## Freshness del piloto

La política inicial del piloto exige:

- backup gestionado: máximo 26 horas;
- restore drill: máximo 90 días;
- cifrado en reposo: obligatorio;
- estado operacional del backup: `ok`.

Los límites son controles internos de ingeniería y pueden endurecerse por
deployment. Reducir su cobertura requiere una decisión explícita y documentada.

## Restore

El restore real se ejecuta mediante el procedimiento gestionado por Kairoseth /
proveedor MongoDB sobre un entorno controlado. Puente solo consume evidencia
sanitizada del resultado.

Durante un rollback de código no se restaura automáticamente MongoDB. Un restore
de datos solo procede ante daño confirmado y tras revisar posibles remisiones
AEAT posteriores al punto de recuperación para evitar reemisiones o pérdida de
estado fiscal.

## Perfil standalone

El tooling SQLite de `docs/backup-lifecycle-policy.md` continúa disponible para
`standalone`, desarrollo, test y despliegues técnicos independientes. No es el
gate de backup del candidato productivo Kairoseth v0.1.0.
