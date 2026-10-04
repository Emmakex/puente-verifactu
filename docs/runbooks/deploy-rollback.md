# Runbook — deploy, verificación y rollback Kairoseth

## Objetivo

Desplegar una nueva versión del perfil productivo
`kairoseth-hostinger-mongodb` sin perder estado fiscal ni romper idempotencia,
y volver atrás de forma segura si la aplicación falla.

SQLite no participa en la persistencia productiva de este perfil. El tooling
SQLite sigue disponible únicamente para `standalone`, desarrollo y test; su
procedimiento está documentado en `backup-restore.md`.

## Precondiciones

- CI de `main` completamente verde para el SHA exacto.
- Commit/release objetivo identificado.
- `/readyz` y `/v1/ops/status` del deployment actual en estado sano.
- Evidencia gestionada de backup MongoDB reciente, cifrada y con restore drill
  vigente según `docs/kairoseth-backup-evidence.md`.
- Configuración Kairoseth Auth, stores MongoDB, outbox y
  `backupStatusProvider` inyectados por la plataforma.
- Declaración responsable y gates de piloto/release aplicables al candidato.
- Ventana de mantenimiento definida si el cambio requiere parada.

No continuar si el snapshot operacional contiene warnings/critical,
`reconciliation_required`, operaciones bloqueadas o leases expirados.

## Evidencia previa

Con una credencial operacional independiente:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $PV_OPS_TOKEN" \
  "$PV_PUBLIC_BASE_URL/v1/ops/status" \
  > "$HOME/.puente-verifactu/evidence/pre-deploy-ops.json"
chmod 600 "$HOME/.puente-verifactu/evidence/pre-deploy-ops.json"
```

El token debe llegar por variable de entorno o secret manager, nunca persistido
en scripts, logs ni repositorio.

## Despliegue

1. Colocar el nuevo código/artefacto en una release nueva; no modificar una
   release anterior in-place.
2. Mantener fuera de Git auth, secretos, certificado y configuración privada.
3. Detener/reiniciar el proceso según el mecanismo de Hostinger/Kairoseth,
   conservando cierre graceful.
4. Activar el SHA exacto del candidato.
5. Verificar:

```bash
curl --fail --silent --show-error "$PV_PUBLIC_BASE_URL/healthz"
curl --fail --silent --show-error "$PV_PUBLIC_BASE_URL/readyz"
curl --fail --silent --show-error \
  -H "Authorization: Bearer $PV_OPS_TOKEN" \
  "$PV_PUBLIC_BASE_URL/v1/ops/status"
```

## Criterios para abrir tráfico

- `/healthz = 200`.
- `/readyz = 200`.
- `mode = kairoseth-mongodb`.
- `database.ok = true`.
- `backup.configured = true` y `backup.status = ok`.
- `summary.status = ok`.
- cero `reconciliation_required`, `blocked` y leases expirados.
- SHA desplegado coincide con el candidato aprobado.

## Rollback de código

Si falla la aplicación pero MongoDB y el estado fiscal siguen íntegros:

1. detener la release fallida;
2. volver al código/artefacto anterior;
3. arrancar;
4. repetir health/readiness/ops;
5. reconciliar cualquier operación incierta antes de reabrir envíos.

**No restaurar automáticamente MongoDB durante un rollback de código.** Un
restore podría eliminar registros creados después del punto de backup y provocar
pérdida de evidencia o riesgo de reemisión.

## Cuándo restaurar datos

Solo ante daño confirmado o una migración incompatible que no pueda revertirse
preservando estado. El restore se realiza mediante el procedimiento gestionado
Kairoseth/proveedor MongoDB, no mediante comandos SQLite.

Antes de restaurar:

- detener efectos fiscales;
- identificar el punto de recuperación;
- comparar con remisiones AEAT posteriores;
- marcar como `reconciliation_required` cualquier identidad cuyo estado remoto
  pueda no estar representado en el punto restaurado;
- obtener aprobación operativa explícita.

## Verificación post-rollback/restore

- health/readiness verdes;
- `mode=kairoseth-mongodb`;
- outbox sin leases expirados nuevos;
- cero reenvíos automáticos de operaciones inciertas;
- backup monitoring sano;
- registrar SHA fallido, SHA restaurado y referencias opacas de evidencia, sin
  secretos ni payload fiscal.

## Perfil standalone

Para SQLite `standalone`, usar `docs/runbooks/backup-restore.md` y los comandos
`npm run sqlite:backup`, `npm run sqlite:verify-backup` y
`npm run sqlite:restore`. Ese perfil no es el candidato productivo Kairoseth.
