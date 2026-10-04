# Evidencia de backup gestionado — Kairoseth / MongoDB

Este contrato aplica al perfil productivo `kairoseth-hostinger-mongodb`.

El runtime de Puente VeriFactu no administra directamente snapshots, credenciales ni restores del MongoDB productivo. Kairoseth inyecta el estado de backup en observabilidad y conserva la operación del proveedor dentro de su infraestructura.

## Doble evidencia obligatoria

Antes de abrir un piloto fiscal real deben existir dos señales coherentes:

1. `/v1/ops/status` con `backup.configured=true` y `backup.status=ok`;
2. un informe privado `kairoseth-managed-backup-readiness` que demuestre backup remoto, cifrado, reciente y restore drill satisfactorio.

Referencia: `config/kairoseth-backup-readiness.example.json`.

## Contrato sanitizado

El informe no contiene URI MongoDB, usuario, password, token, certificado, URL firmada ni payload fiscal.

El fingerprint `sha256` identifica el backup o un manifest sanitizado que lo representa. No debe ser una credencial. El restore drill debe referenciar exactamente el mismo fingerprint para demostrar que se probó la copia que se está dando por válida.

Campos críticos:

- `deploymentProfile=kairoseth-hostinger-mongodb`;
- `kind=kairoseth-managed-backup-readiness`;
- `status=ok`;
- `newestBackup.remote=true`;
- `newestBackup.encryptedAtRest=true`;
- `newestBackup.sha256` válido;
- `restoreDrill.result=ok`;
- `restoreDrill.backupSha256 === newestBackup.sha256`;
- `containsSecrets=false`;
- `containsFiscalData=false`.

El campo `provider` debe ser una referencia descriptiva no secreta. No debe contener URLs firmadas, tokens, query strings sensibles ni credenciales.

## Freshness del piloto

La política inicial exige:

- backup: máximo 26 horas;
- restore drill: máximo 90 días.

Estos límites son controles internos de ingeniería. El gate `pilot:readiness` falla cerrado si la evidencia está caducada.

## Restore

Un rollback de código **no restaura MongoDB automáticamente**. El restore de datos solo procede ante daño confirmado, mediante el procedimiento gestionado por Kairoseth/proveedor y tras revisar remisiones AEAT posteriores al punto de recuperación.

Cualquier identidad fiscal cuyo estado remoto pueda no estar representado en el punto restaurado debe tratarse como `reconciliation_required`, nunca como candidata a reemisión ciega.

## Perfil standalone

El tooling SQLite de `docs/backup-lifecycle-policy.md` y `docs/runbooks/backup-restore.md` permanece disponible para `standalone`, desarrollo y test. No acredita el backup productivo del candidato Kairoseth.
