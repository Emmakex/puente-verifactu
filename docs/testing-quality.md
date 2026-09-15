# Testing y calidad

## Estrategia

### Unit tests

Reglas de dominio, normalización, decimales, validadores, idempotencia, estado y funciones puras de hash.

### Contract tests

Modelo canónico, conectores, adaptador AEAT, serialización y normalización de respuestas.

### Fixtures regulatorios

Vectores conocidos para hash/encadenamiento y ejemplos oficiales versionados. Un cambio en fixtures reguladores requiere revisión explícita.

### Integration tests

Persistencia, outbox, colas, secret provider, certificados simulados y callbacks.

### External sandbox tests

Portal de pruebas AEAT cuando esté disponible: alta válida, rechazo controlado, anulación/corrección, duplicado, timeout/reintento y lote si aplica.

### Acceptance

Flujo extremo a extremo desde un conector de referencia hasta estado final y reconciliación.

## Gates mínimos

- lint/format;
- typecheck;
- unit;
- contract;
- integration afectada;
- security checks relevantes;
- prueba regulatoria cuando cambie material AEAT;
- documentación del contrato modificado.

**Minimum sufficient validation:** ejecutar los gates necesarios para el contrato cambiado, no trabajo no relacionado.

## Regresión

Todo bug confirmado debe producir una prueba que falle antes del fix y pase después, siempre que sea técnicamente razonable.

## Datos de prueba

No utilizar certificados, NIF o datos personales reales en fixtures públicos. Separar secretos de sandbox de los repositorios.
