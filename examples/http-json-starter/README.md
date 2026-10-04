# HTTP/JSON Starter Kits v1

Starter kits mínimos para integrar ERP, CRM, software propio o middleware con Kairoseth Fiscal / Puente VeriFactu sin implementar reglas AEAT en el sistema origen.

## Principios

- HTTPS saliente hacia la API de Kairoseth Fiscal.
- Token Bearer server-to-server; nunca se expone en navegador ni se versiona.
- El origen envía hechos comerciales y un `profileId` cuando usa MappingProfile.
- `organizationId`, `installationId`, `sourceSystem`, certificado y reglas AEAT permanecen server-side.
- Toda creación o cancelación usa `Idempotency-Key`.
- Rectificaciones reutilizan `POST /v1/fiscal-records` con un IntegrationProfile correctivo; el origen no decide R1–R5 ni S/I.
- Estado y reconciliación se consultan mediante `GET /v1/fiscal-records/{recordId}/status`.

## Configuración

Define variables de entorno:

```bash
export PUENTE_BASE_URL="https://fiscal.kairoseth.com"
export PUENTE_TOKEN="..."
```

No copies tokens reales a ficheros, Git, tickets, logs ni ejemplos.

Los payloads de referencia ya existentes son:

- `../api-lifecycle/create.json`
- `../api-lifecycle/rectification.json`
- `../api-lifecycle/cancel.json`

## Node.js 22+

```bash
node examples/http-json-starter/node/client.mjs preflight examples/api-lifecycle/create.json
node examples/http-json-starter/node/client.mjs issue examples/api-lifecycle/create.json erp-invoice-2026-100
node examples/http-json-starter/node/client.mjs status fr_0123456789abcdef01234567
node examples/http-json-starter/node/client.mjs rectify examples/api-lifecycle/rectification.json erp-credit-note-2026-15
node examples/http-json-starter/node/client.mjs cancel fr_0123456789abcdef01234567 erp:cancellation:2026-100 cancel-2026-100
```

## Python 3

```bash
python3 examples/http-json-starter/python/client.py preflight examples/api-lifecycle/create.json
python3 examples/http-json-starter/python/client.py issue examples/api-lifecycle/create.json erp-invoice-2026-100
python3 examples/http-json-starter/python/client.py status fr_0123456789abcdef01234567
python3 examples/http-json-starter/python/client.py rectify examples/api-lifecycle/rectification.json erp-credit-note-2026-15
python3 examples/http-json-starter/python/client.py cancel fr_0123456789abcdef01234567 erp:cancellation:2026-100 cancel-2026-100
```

Usa únicamente la librería estándar.

## PHP 7.4+

```bash
php examples/http-json-starter/php/client.php preflight examples/api-lifecycle/create.json
php examples/http-json-starter/php/client.php issue examples/api-lifecycle/create.json erp-invoice-2026-100
php examples/http-json-starter/php/client.php status fr_0123456789abcdef01234567
php examples/http-json-starter/php/client.php rectify examples/api-lifecycle/rectification.json erp-credit-note-2026-15
php examples/http-json-starter/php/client.php cancel fr_0123456789abcdef01234567 erp:cancellation:2026-100 cancel-2026-100
```

Requiere la extensión cURL de PHP.

## cURL

`curl.sh` muestra el contrato HTTP más pequeño posible. Lee las mismas variables de entorno y no almacena credenciales.

## Flujo recomendado

```text
source data
 -> POST /v1/preflight
 -> corregir mapping/datos si procede
 -> POST /v1/fiscal-records + Idempotency-Key
 -> guardar recordId
 -> GET /v1/fiscal-records/{recordId}/status
 -> reconciliar estado
```

Para anular:

```text
recordId existente
 -> POST /v1/fiscal-records/{recordId}/cancel
 -> Idempotency-Key estable
 -> guardar nuevo recordId de anulación
 -> consultar /status
```

Estos kits son adaptadores finos. No deben contener XML/SOAP AEAT, certificados, claves privadas ni reglas fiscales.
