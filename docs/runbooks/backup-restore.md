# Runbook — backup, restore y recuperación

## Objetivo

Recuperar el perfil SQLite single-node sin sobrescribir un store sano ni provocar reenvíos fiscales por pérdida de estado local.

## Crear backup en caliente

El backup usa snapshot consistente aunque SQLite esté en WAL:

```bash
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/var/backups/puente-verifactu/puente-$STAMP.sqlite"
npm run sqlite:backup -- --db "$PV_DATABASE_PATH" --out "$BACKUP"
npm run sqlite:verify-backup -- --backup "$BACKUP"
```

Criterios mínimos:

- `status: ok`;
- SHA-256 presente;
- `integrity_check: ok`;
- `foreign_key_check` sin incidencias;
- manifest asociado conservado junto al backup.

## Verificar un backup antes de usarlo

```bash
npm run sqlite:verify-backup -- --backup "$BACKUP"
```

No continuar con restore si checksum, manifest o integridad fallan.

## Restore a una ruta nueva

Preferido para comprobación y recuperación controlada:

```bash
npm run sqlite:restore -- --backup "$BACKUP" --db "/var/lib/puente-verifactu/recovery.sqlite"
```

Validar la copia recuperada antes de convertirla en store activo.

## Restore in-place

Solo con la instancia detenida. Confirmar que no quedan procesos usando SQLite y que no hay sidecars WAL/SHM activos.

```bash
npm run sqlite:restore -- \
  --backup "$BACKUP" \
  --db "$PV_DATABASE_PATH" \
  --replace \
  --offline-confirmation
```

Las dos flags son deliberadas: un reemplazo in-place no debe ocurrir por accidente.

## Verificación tras restore

1. Arrancar una única instancia.
2. Comprobar:

```bash
curl --fail --silent --show-error "$PV_PUBLIC_BASE_URL/healthz"
curl --fail --silent --show-error "$PV_PUBLIC_BASE_URL/readyz"
curl --fail --silent --show-error \
  -H "Authorization: Bearer $PV_OPS_TOKEN" \
  "$PV_PUBLIC_BASE_URL/v1/ops/status"
```

3. Comparar el timestamp del backup con cualquier evidencia de remisiones AEAT posteriores.
4. Si pudieron existir remisiones después del punto restaurado, **no reemitirlas automáticamente**. Tratar esos casos como reconciliación explícita antes de volver a enviar.
5. Confirmar que cadena fiscal, API/idempotencia y outbox están disponibles.

## Fallo de restore

Si el restore falla:

- no borrar el backup original;
- no arrancar con una base parcialmente sustituida;
- conservar el target previo si sigue íntegro;
- registrar el código de error y escalar con evidencia mínima no sensible.

## Retención y almacenamiento remoto

Este runbook cubre la mecánica local verificada. La política de cifrado del repositorio de backups, almacenamiento remoto, retención y ejercicios periódicos sigue siendo un gate separado de Fase 6 y debe adaptarse al entorno de producción real.
