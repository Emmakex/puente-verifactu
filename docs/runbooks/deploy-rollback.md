# Runbook — deploy, verificación y rollback

## Objetivo

Desplegar una nueva versión del perfil single-node sin perder estado fiscal ni romper idempotencia, y volver atrás de forma segura si la aplicación falla.

## Precondiciones

- CI de `main` completamente verde.
- Commit/release objetivo identificado y checksum del artefacto conservado.
- `PV_DATABASE_PATH` confirmado.
- Ventana de mantenimiento definida si el cambio requiere parada.
- Backup creado y verificado antes de cualquier cambio que pueda afectar al store.
- Gate AEAT #6 cerrado antes de considerar un despliegue fiscal real; mientras siga abierto, el despliegue es técnico/no fiscal.

## Backup previo

```bash
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
npm run sqlite:backup -- --db "$PV_DATABASE_PATH" --out "/var/backups/puente-verifactu/puente-$STAMP.sqlite"
npm run sqlite:verify-backup -- --backup "/var/backups/puente-verifactu/puente-$STAMP.sqlite"
```

No continuar si la verificación no devuelve `status: ok`, `integrity_check: ok` y sin errores de foreign keys.

## Despliegue

1. Colocar el nuevo código/artefacto en un directorio de release nuevo; no modificar una release anterior in-place.
2. Conservar fuera de Git los ficheros de auth/integraciones y cualquier material sensible.
3. Detener la instancia mediante el gestor de servicios del entorno para obtener cierre `SIGTERM`/graceful.
4. Cambiar la release activa.
5. Arrancar la instancia.
6. Verificar inmediatamente:

```bash
curl --fail --silent --show-error "$PV_PUBLIC_BASE_URL/healthz"
curl --fail --silent --show-error "$PV_PUBLIC_BASE_URL/readyz"
```

7. Con una credencial operacional independiente:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $PV_OPS_TOKEN" \
  "$PV_PUBLIC_BASE_URL/v1/ops/status"
```

El token debe llegar por variable de entorno o secret manager, nunca como valor persistido en scripts o repositorio.

## Criterios para abrir tráfico

- `/healthz` = 200.
- `/readyz` = 200.
- `summary.status` no es `critical`.
- No aparecen nuevas operaciones `reconciliation_required` o `blocked` atribuibles al despliegue.
- Backup previo verificado y localizable.

## Rollback de código

Si falla la aplicación pero la base sigue íntegra:

1. Detener la instancia.
2. Volver a la release de código anterior.
3. Arrancar.
4. Repetir health/readiness/ops status.

**No restaurar automáticamente la base de datos durante un rollback de código.** Un restore podría borrar registros creados después del backup y provocar riesgo de duplicación o pérdida de evidencia.

## Cuándo restaurar la base

Solo si existe daño confirmado del store o una migración incompatible que no pueda revertirse preservando datos. En ese caso, mantener el servicio detenido y usar `backup-restore.md`.

## Verificación post-rollback

- health/readiness verdes;
- outbox sin leases expirados nuevos;
- cualquier `reconciliation_required` revisado antes de permitir reenvíos;
- registrar commit fallido, commit restaurado, backup usado y evidencia mínima del incidente sin secretos.
