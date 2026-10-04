# Kairoseth MongoDB runtime — perfil productivo

## Regla

El deployment productivo de Kairoseth Fiscal usa:

- Hostinger;
- MongoDB;
- Auth/tenant authority de Kairoseth;
- stores inyectados;
- certificado/AEAT server-side.

SQLite pertenece únicamente al perfil `standalone` de desarrollo, prueba y
referencia single-node.

## Selección explícita

```js
createPuenteRuntime({
  persistenceMode: "kairoseth",
  // no databasePath
  fiscalRecordStore,
  integrationDataStore,
  importSessionStore,
  importBatchStore,
  localAgentRegistryStore,
  aeatOutboxStore,
  backupStatusProvider,
});
```

El modo Kairoseth falla cerrado si falta una dependencia.

## Persistencia productiva

| Dominio | Persistencia |
|---|---|
| cadena fiscal / operación idempotente | MongoDB |
| API records | MongoDB |
| Idempotency-Key HTTP | MongoDB + lease |
| sesiones CSV/XLSX | MongoDB TTL |
| batches CSV/XLSX | MongoDB durable + lease |
| Local Agent registry | MongoDB |
| onboarding profiles | MongoDB |
| integration profiles | MongoDB |
| AEAT outbox | MongoDB + lease/reconciliation |
| backup health | provider Kairoseth inyectado |
| readiness/ops | health providers MongoDB |

Puente recibe interfaces ya resueltas. Los adapters de persistencia no reciben
Mongo URI, contraseña ni `MongoClient`, y no crean índices/colecciones por su
cuenta. La infraestructura los provisiona.

## Semántica de cadena fiscal

El store fiscal serializa writers por `chainKey` mediante lease. Dentro del
lease:

1. vuelve a comprobar `operationKey`;
2. lee el último registro;
3. crea el siguiente registro con el mismo core fiscal;
4. valida secuencia/previous hash;
5. inserta un documento inmutable con índice único por cadena/secuencia y
   operación.

Un retry de la misma operación devuelve el registro existente si el
`fingerprint` coincide; contenido distinto devuelve conflicto.

## Idempotencia HTTP

Una Idempotency-Key reserva un documento con lease. Si el proceso cae antes de
completarla, otro proceso puede recuperarla tras la expiración. Si el registro
ya se completó, el retry devuelve el mismo `recordId`.

No se borran reservas pendientes globalmente al arrancar el runtime Kairoseth.

## AEAT outbox

El outbox MongoDB conserva la semántica del perfil standalone:

```text
pending -> processing -> completed|blocked|pending|reconciliation_required
```

Un lease que expira después de iniciar dispatch pasa a
`reconciliation_required`; nunca provoca reenvío ciego.

## Readiness y observabilidad

- `/healthz`: proceso HTTP vivo;
- `/readyz`: healthcheck de persistencia MongoDB;
- `/v1/ops/status`: snapshot protegido por `ops:read` con
  `mode: "kairoseth-mongodb"`.

El snapshot usa contadores del outbox y el estado de backup inyectado sin
exponer payload fiscal, NIF, XML/SOAP, secretos ni IDs de jobs.

## Backup

Puente no ejecuta ni administra por sí mismo el backup de la infraestructura
MongoDB de Kairoseth. El deployment inyecta `backupStatusProvider`, que debe
reportar como mínimo:

- `configured`;
- `status`;
- `createdAt`;
- `ageMs`.

La política del piloto exige estado `ok` y evidencia del lifecycle/restore
real del deployment.

## Evidencia CI

El smoke real MongoDB demuestra:

- arranque sin `databasePath`;
- `persistence.database === null`;
- emisión fiscal;
- retry idempotente tras reinicio;
- readiness;
- ops status;
- AEAT outbox aceptado;
- cuarentena por lease expirado;
- estado de backup inyectado.
