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

## Alcance

SQLite es el perfil de despliegue simple de Fase 4: **una instancia de aplicación / un nodo con volumen persistente**.

No se presenta como solución HA o multi-réplica. Un deployment distribuido deberá usar un store transaccional compartido (por ejemplo PostgreSQL) y una estrategia de locking distribuido; eso pertenece al hardening/Production Readiness.

## Backups

El fichero de base de datos es estado crítico. La política automatizada de backup/restore y su prueba periódica pertenecen a Fase 6. No debe copiarse de forma improvisada mientras haya escrituras activas; usar procedimientos SQLite compatibles con WAL o detener limpiamente el proceso antes de una copia consistente.
