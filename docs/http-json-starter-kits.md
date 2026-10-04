# HTTP/JSON Starter Kits v1

## Objetivo

Dar a ERP, CRM y software propio una vía de integración mínima, copiable y auditable sin duplicar lógica fiscal fuera de Kairoseth Fiscal.

Los kits viven en `examples/http-json-starter/` y cubren:

- Node.js 22+;
- Python 3 con librería estándar;
- PHP 7.4+ con cURL;
- cURL/shell como referencia del contrato HTTP.

## Lifecycle común

Todos implementan exactamente la misma secuencia:

```text
preflight
 -> issue
 -> status
 -> rectify (misma ruta issue + profile correctivo)
 -> cancel
```

Rutas:

- `POST /v1/preflight`;
- `POST /v1/fiscal-records`;
- `GET /v1/fiscal-records/{recordId}/status`;
- `POST /v1/fiscal-records/{recordId}/cancel`.

Creación, rectificación y cancelación requieren una `Idempotency-Key` estable definida por el sistema origen.

## Frontera fiscal

El starter kit no puede contener:

- XML/SOAP AEAT;
- endpoints directos AEAT;
- certificado/PFX/private key;
- NIF/tenant técnico como autoridad;
- clasificación fiscal hardcoded;
- reglas R1–R5 o S/I decididas por el cliente.

La rectificación reutiliza un IntegrationProfile correctivo server-side. El origen aporta hechos e importes; Kairoseth Fiscal conserva la autoridad sobre MappingProfile, clasificación y reglas AEAT.

## Configuración

Solo se necesitan dos variables en el cliente:

```text
PUENTE_BASE_URL
PUENTE_TOKEN
```

El token es server-to-server y no debe exponerse en frontend, archivos versionados ni logs.

## Ejemplos canónicos

Los kits reutilizan los fixtures de lifecycle ya protegidos por CI:

- `examples/api-lifecycle/create.json`;
- `examples/api-lifecycle/rectification.json`;
- `examples/api-lifecycle/cancel.json`.

Esto evita mantener una segunda definición de payloads.

## Gate CI

`npm run starter:http-json:check` valida:

- presencia de los cuatro kits;
- preflight/create/status/cancel;
- idempotencia;
- rectificación por la misma ruta de creación;
- URL encoding de `recordId`;
- ausencia de transporte AEAT directo y material criptográfico;
- ausencia de reglas fiscales dentro de los clientes;
- Python sin dependencias externas.

El gate forma parte de `npm run check`.
