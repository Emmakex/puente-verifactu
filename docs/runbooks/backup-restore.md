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

## Copia remota y política de retención

Después de crear el backup, el proceso externo de almacenamiento debe:

1. subir backup + manifest a un destino remoto;
2. verificar el SHA-256 después de la copia;
3. confirmar cifrado en reposo;
4. registrar evidencia mínima según `docs/backup-lifecycle-policy.md`;
5. ejecutar el check de política.

```bash
npm run backup:lifecycle:check -- \
  --dir /var/backups/puente-verifactu \
  --policy /etc/puente-verifactu/backup-policy.json \
  --remote-evidence /var/lib/puente-verifactu/evidence/remote-copies.json \
  --restore-drill-evidence /var/lib/puente-verifactu/evidence/latest-restore-drill.json
```

La política v1 propone retención 7 diarios / 5 semanales / 12 mensuales. La salida identifica candidatos a poda, pero **Puente VeriFactu no borra backups automáticamente**. El borrado sigue siendo una decisión del sistema de almacenamiento y de la política operativa/legal del deployment.

## Restore drill periódico

Un backup no se considera operativamente demostrado solo porque exista. Ejecutar periódicamente un restore drill contra una copia verificada:

```bash
npm run backup:restore-drill -- \
  --backup "$BACKUP" \
  --evidence /var/lib/puente-verifactu/evidence/restore-drill-"$STAMP".json
```

El drill restaura únicamente a un directorio temporal, verifica checksum, `integrity_check` y `foreign_key_check`, genera evidencia con permisos restrictivos y elimina la copia temporal. **Nunca reemplaza la base activa.**

La política de ejemplo exige un drill como máximo cada 90 días. Cada entorno debe conservar fuera de Git la evidencia del drill y de la copia remota cifrada.

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
6. Volver a ejecutar `backup:lifecycle:check` cuando la evidencia del entorno haya sido actualizada.

## Fallo de restore

Si el restore falla:

- no borrar el backup original;
- no arrancar con una base parcialmente sustituida;
- conservar el target previo si sigue íntegro;
- registrar el código de error y escalar con evidencia mínima no sensible.

## Conformidad del deployment

El tooling y la política están implementados en el repositorio, pero **un entorno concreto no se considera conforme** hasta aportar evidencia real de:

- backup dentro de la antigüedad admitida;
- copia remota del checksum requerido;
- cifrado en reposo;
- restore drill vigente.

El proveedor y scheduler son intercambiables; sus credenciales nunca se guardan en este repositorio.
