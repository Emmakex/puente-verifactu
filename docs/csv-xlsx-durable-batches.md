# CSV/XLSX durable batches — Kairoseth MongoDB

## Objetivo

Convertir la importación de archivos en un flujo productivo reanudable sin
persistir el fichero original ni permitir una emisión accidental antes de que
el usuario confirme.

## Flujo

```text
upload bytes
  -> parse CSV/XLSX
  -> temporary Mongo session (TTL)
  -> mapping
  -> preflight (sin efectos)
  -> explicit confirm
  -> frozen InvoiceIntent rows
  -> durable Mongo batch
  -> lease
  -> issue/retry with stable row idempotency
  -> status/history
  -> JSON/CSV export
```

## Persistencia

Kairoseth inyecta dos stores al runtime:

- `importSessionStore`: sesión temporal con TTL;
- `importBatchStore`: batch confirmado durable.

Puente no recibe `MongoClient`, URI, contraseña ni variables de conexión. Los
adapters reciben únicamente la interfaz `database.collection()` ya resuelta
por Kairoseth.

Los dos stores deben inyectarse juntos. Una configuración híbrida
Mongo-sesión/memoria-batch falla cerrada.

## Sesión temporal

Se conserva:

- `importId`;
- organización/instalación/source;
- filas parseadas;
- cabeceras;
- metadata de hoja/archivo;
- assistant de mapping;
- timestamps/TTL.

No se conserva:

- Buffer original;
- bytes XLSX/CSV;
- `rawBody`;
- secretos.

## Confirmación

`confirm` vuelve a ejecutar preflight. Solo si todas las filas son válidas se
crea el batch.

Cada fila confirmada guarda internamente:

- número de fila;
- `InvoiceIntent` congelado;
- `Idempotency-Key = importId:row:<n>`;
- estado de ejecución;
- resultado mínimo;
- contador de intentos.

El cliente nunca recibe el intent congelado.

## Concurrencia y recuperación

Un worker debe adquirir un lease atómico. Durante el proceso el lease se renueva
al cerrar filas.

Si el proceso cae:

1. el lease expira;
2. otro worker puede reanudar;
3. las filas ya `issued` se omiten;
4. una fila cuyo resultado remoto ocurrió justo antes de la caída conserva la
   misma Idempotency-Key en el retry;
5. el core devuelve el mismo recurso/idempotencia en lugar de crear otro.

Los fallos no retryable quedan terminales hasta intervención explícita.

## Export seguro

JSON y CSV contienen únicamente estado operativo por fila:

- row;
- status;
- recordId;
- duplicate;
- fiscalStatus;
- errorCode/retryable;
- attempts.

No contienen intents, NIF, descripciones, XML/SOAP AEAT ni el fichero original.

## Infraestructura

Kairoseth productivo:

- Hostinger;
- MongoDB;
- índices provisionados por la capa de infraestructura;
- TTL Mongo para sesiones;
- índices tenant + installation para aislamiento.

SQLite/memoria siguen siendo perfiles standalone/development y no sustituyen la
persistencia productiva Kairoseth.
