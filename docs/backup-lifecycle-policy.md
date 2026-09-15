# Política de ciclo de vida de backups — perfil single-node

Esta política complementa el backup/restore SQLite ya implementado. Su objetivo es que un backup no cuente como protección real hasta que exista evidencia verificable de copia remota cifrada y de un restore drill reciente.

## Principios

- El backup local se crea con `npm run sqlite:backup` y conserva SHA-256 + manifest.
- El destino remoto es intercambiable: S3-compatible, Backblaze B2, Azure Blob, Google Cloud Storage, almacenamiento gestionado del proveedor o equivalente.
- El repositorio no contiene credenciales del proveedor ni ejecuta borrados remotos.
- La copia remota debe verificarse por checksum después de subirla y registrar evidencia mínima no sensible.
- La retención se calcula como plan; Puente VeriFactu **no borra backups automáticamente**.
- Un restore drill restaura a un directorio temporal, verifica checksum e integridad SQLite y elimina la copia temporal.
- El gate AEAT #6 sigue siendo independiente y continúa bloqueando release/piloto fiscal real.

## Política por defecto v1

`config/backup-policy.example.json` define:

- backup local más reciente: máximo 26 horas;
- copia remota obligatoria;
- cifrado en reposo remoto obligatorio;
- restore drill: como máximo cada 90 días;
- retención: 7 diarios, 5 semanales y 12 mensuales.

La política puede adaptarse al entorno, pero reducir cobertura debe ser una decisión explícita y documentada.

## Evidencia de copia remota

El proceso externo que sube un backup debe verificar su SHA-256 y producir un fichero JSON local/protegido con este contrato:

```json
{
  "schema_version": 1,
  "kind": "puente-backup-remote-evidence",
  "copies": [
    {
      "sha256": "<sha256-del-backup>",
      "copied_at": "2026-09-15T10:00:00.000Z",
      "encrypted_at_rest": true,
      "reference": "provider-neutral-object-reference"
    }
  ]
}
```

`reference` debe ser un identificador opaco útil para operación, nunca una URL firmada, token, password o clave del proveedor.

## Restore drill

Ejecutar contra un backup ya verificado:

```bash
npm run backup:restore-drill -- \
  --backup /var/backups/puente-verifactu/puente-YYYYMMDD.sqlite \
  --evidence /var/lib/puente-verifactu/evidence/restore-drill-YYYYMMDD.json
```

El comando:

1. verifica backup + manifest + SHA-256;
2. restaura a un directorio temporal nuevo;
3. ejecuta `integrity_check` y `foreign_key_check`;
4. compara el checksum restaurado;
5. escribe evidencia con permisos restrictivos;
6. elimina el directorio temporal.

Nunca reemplaza la base activa.

## Comprobar la política

```bash
npm run backup:lifecycle:check -- \
  --dir /var/backups/puente-verifactu \
  --policy /etc/puente-verifactu/backup-policy.json \
  --remote-evidence /var/lib/puente-verifactu/evidence/remote-copies.json \
  --restore-drill-evidence /var/lib/puente-verifactu/evidence/latest-restore-drill.json
```

La comprobación vuelve `status: failed` si:

- el backup más reciente supera la antigüedad máxima;
- falta una copia remota requerida para un backup que debe conservarse;
- la copia remota no declara cifrado en reposo cuando la política lo exige;
- falta un restore drill;
- el drill es demasiado antiguo;
- la evidencia del drill no corresponde a un backup local verificado.

## Retención

La salida incluye `retained` y `pruneCandidates`. Son una **propuesta**, no una orden de borrado. Antes de borrar un candidato se debe confirmar que:

- no está retenido por una política legal/contractual adicional;
- existe al menos la cobertura remota exigida;
- no es la única copia asociada a una investigación o incidente;
- el borrado se realiza en el sistema de almacenamiento correspondiente con sus propias guardas.

## Programación recomendada

- backup: diario como mínimo;
- copia remota + checksum: inmediatamente después de crear el backup;
- `backup:lifecycle:check`: diario;
- restore drill: trimestral como máximo con la política v1;
- revisión de retención: mensual.

El scheduler puede ser systemd timer, cron del host, pipeline del proveedor o equivalente. La política es independiente del scheduler.

## Evidencia para release/operación

Conservar fuera de Git:

- manifest del backup;
- recibo de copia remota por checksum;
- evidencia del último restore drill;
- salida sanitizada del lifecycle check;
- referencia del incidente si una comprobación falla.

Nunca conservar aquí certificados, claves privadas, tokens o payload fiscal completo.
