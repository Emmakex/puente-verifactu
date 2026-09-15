# Testing y calidad

## Estrategia

### Unit tests

Reglas de dominio, normalización, decimales, validadores, idempotencia, estado y funciones puras de hash.

### Contract tests

Modelo canónico, conectores, adaptador AEAT, serialización y normalización de respuestas.

Los conectores externos disponen además de `packages/connector-contract-suite`, un runner framework-neutral que valida la interfaz mínima, preflight, idempotencia estable, `eventId`, status, no mutación y ausencia de autoridad sensible inyectada por el conector.

Nuestro gate de referencia es:

```bash
npm run contract:reference
```

Un nuevo conector nativo no se considera compatible hasta pasar la versión de suite contractual aplicable.

### Fixtures regulatorios

Vectores conocidos para hash/encadenamiento y ejemplos oficiales versionados. Un cambio en fixtures reguladores requiere revisión explícita.

### Integration tests

Persistencia, outbox, colas, secret provider, certificados simulados, callbacks y sesiones temporales de importación.

### Customer-facing / onboarding

Todo cambio de interfaz o onboarding debe mantener ES/EN conjuntamente y cubrir el contrato responsive/UX afectado.

El flujo cero-código tiene un gate explícito `npm run onboarding:smoke` que valida:

1. carga de archivo;
2. detección de formato;
3. mapping asistido;
4. configuración fija;
5. preflight sin efectos;
6. presencia de copy ES/EN.

Los tests también cubren aislamiento de sesión por organización/instalación, expiración, allowlists de mapping/configuración y protección contra prototype pollution.

### External sandbox tests

Portal de pruebas AEAT cuando esté disponible: alta válida, rechazo controlado, anulación/corrección, duplicado, timeout/reintento y lote si aplica.

### Acceptance

Flujo extremo a extremo desde un conector de referencia hasta estado final y reconciliación. Para el canal cero-código, aceptación desde CSV/XLSX hasta preflight comprensible para usuario no técnico.

## Gates mínimos

- lint/format cuando exista tooling aplicable;
- typecheck cuando exista contrato tipado aplicable;
- unit;
- contract;
- connector contract suite para conectores nuevos/modificados;
- integration afectada;
- UX/responsive/ES-EN para cambios customer-facing;
- security checks relevantes;
- prueba regulatoria cuando cambie material AEAT;
- documentación del contrato modificado.

**Minimum sufficient validation:** ejecutar los gates necesarios para el contrato cambiado, no trabajo no relacionado.

## Regresión

Todo bug confirmado debe producir una prueba que falle antes del fix y pase después, siempre que sea técnicamente razonable.

## Datos de prueba

No utilizar certificados, NIF o datos personales reales en fixtures públicos. Separar secretos de sandbox de los repositorios.
