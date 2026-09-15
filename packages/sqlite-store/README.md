# SQLite Store

Persistencia durable sin dependencias externas para el despliegue simple de Puente VeriFactu.

## Objetivo

Permitir que un autónomo, pyme o instalación de una sola instancia pueda ejecutar el puente con un único fichero SQLite y conservar tras reinicios:

- cadena y registros fiscales;
- idempotencia de fiscalización;
- recursos/estado de API;
- idempotencia HTTP;
- sesiones temporales ya parseadas del wizard CSV/XLSX.

No almacena certificados, claves privadas, passphrases ni el binario original de los archivos importados.

## Runtime

Requiere Node.js **22.13+** porque usa `node:sqlite` integrado en Node sin necesidad de dependencias npm adicionales.

El backup v1 usa `VACUUM INTO` de SQLite en vez de elevar el mínimo de Node para depender de APIs añadidas en revisiones posteriores de Node 22.

## Seguridad/durabilidad

La base se abre con:

- foreign keys activas;
- `busy_timeout=5000`;
- WAL para bases en fichero;
- `synchronous=FULL`;
- tablas `STRICT`;
- escrituras de cadena fiscal bajo `BEGIN IMMEDIATE`.

Las invariantes fiscales no se duplican en esta capa. `SqliteFiscalRecordStore` reutiliza `assertFiscalAppend()` del core.

## Uso

```js
import { createSqlitePersistence } from './src/index.mjs';

const persistence = createSqlitePersistence({
  path: '/var/lib/puente-verifactu/puente.sqlite',
});

// persistence.fiscalStore
// persistence.integrationStore
// persistence.importStore

persistence.close();
```

## Backup verificable v1

El backup no copia directamente el fichero principal. Usa SQLite `VACUUM INTO` para producir una instantánea consistente del estado comprometido, incluyendo una base que esté trabajando en WAL.

Cada backup genera dos artefactos:

- `backup.sqlite`: snapshot SQLite con permisos `0600`;
- `backup.sqlite.manifest.json`: manifest versionado con fecha, tamaño, SHA-256 e información mínima de verificación SQLite.

Antes de publicarse, el snapshot debe superar:

- `PRAGMA integrity_check`;
- `PRAGMA foreign_key_check`;
- cálculo SHA-256;
- `fsync` del artefacto y manifest;
- publicación desde temporales mediante `rename`.

El manifest guarda únicamente el nombre del fichero origen, no su ruta absoluta, para no filtrar estructura de infraestructura.

### Crear backup

```bash
npm run sqlite:backup -- \
  --db /var/lib/puente-verifactu/puente.sqlite \
  --out /var/backups/puente-verifactu/puente-2026-09-15.sqlite
```

El comando **no sobrescribe** un backup o manifest existente. Para automatización se recomienda generar nombres únicos por fecha/hora y aplicar una política externa de retención.

### Verificar backup

```bash
npm run sqlite:verify-backup -- \
  --backup /var/backups/puente-verifactu/puente-2026-09-15.sqlite
```

La verificación comprueba manifest, tamaño, SHA-256, integridad interna y foreign keys. Debe ejecutarse periódicamente también sobre backups ya almacenados; que el fichero exista no demuestra que sea restaurable.

## Restore seguro

Restaurar en una ruta nueva es la opción más segura:

```bash
npm run sqlite:restore -- \
  --backup /var/backups/puente-verifactu/puente-2026-09-15.sqlite \
  --db /var/lib/puente-verifactu/restored.sqlite
```

El restore:

1. valida completamente backup + manifest antes de tocar el destino;
2. copia a un fichero staging dentro del mismo directorio del target;
3. vuelve a validar checksum e integridad del staging;
4. sincroniza el fichero;
5. publica mediante `rename`;
6. vuelve a comprobar el SQLite restaurado.

### Reemplazar la base activa

Un restore in-place debe hacerse **con la aplicación detenida**. Requiere dos flags deliberados:

```bash
npm run sqlite:restore -- \
  --backup /var/backups/puente-verifactu/puente-2026-09-15.sqlite \
  --db /var/lib/puente-verifactu/puente.sqlite \
  --replace \
  --offline-confirmation
```

El comando rechaza un target existente si falta alguno de esos consentimientos y rechaza además sidecars `-wal` o `-shm`, señal habitual de que SQLite no se ha cerrado limpiamente. No borra deliberadamente el target antes del swap: prepara y verifica primero la copia de staging.

Después de restaurar, arrancar el servicio y ejecutar readiness/health antes de volver a aceptar tráfico.

## API de mantenimiento

También puede integrarse desde Node:

```js
import {
  createSqliteBackup,
  verifySqliteBackup,
  restoreSqliteBackup,
} from './src/index.mjs';
```

Estas operaciones solo aceptan bases respaldadas por fichero. `:memory:` se rechaza explícitamente.

## Gate de CI

```bash
npm run sqlite:backup:smoke
```

La prueba cubre:

- snapshot point-in-time mientras el origen sigue abierto en WAL;
- restauración de cadena fiscal, API/idempotencia y sesión de importación;
- exclusión de escrituras realizadas después del snapshot;
- detección de corrupción por tamaño/checksum;
- garantía de que un backup inválido no reemplaza el target;
- rechazo de restore sobre un target con WAL/SHM activo;
- confirmación offline obligatoria para reemplazo;
- rechazo de sobrescritura accidental de backups.

## Alcance

SQLite sigue siendo el perfil **single-node**: una instancia de aplicación / un nodo con volumen persistente.

Backup/restore verificable resuelve un gate de Fase 6, pero **no convierte SQLite en una solución HA o multi-réplica**. Un deployment distribuido deberá usar un store transaccional compartido y locking distribuido. Retención remota, cifrado del repositorio de backups, alertas de antigüedad y ejercicios programados de recuperación forman parte del hardening operativo posterior.
