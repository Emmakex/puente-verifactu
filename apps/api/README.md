# API application

Superficie HTTP/framework-neutral del puente. Se limita a autenticación, autorización, parsing, idempotencia y orquestación hacia `core`; no duplica reglas fiscales.

## Endpoints v1

### `POST /v1/preflight`

Valida sin efectos. Acepta:

```json
{ "intent": { "...": "InvoiceIntent v1" } }
```

o una fuente heterogénea con perfil guardado en servidor:

```json
{
  "profileId": "erp-cliente-v1",
  "source": { "NUM_FACTURA": "2026-100" }
}
```

### `POST /v1/fiscal-records`

Fiscaliza una intención canónica o una fuente mapeada. Requiere `Idempotency-Key`.

La identidad fiscal/técnica no se toma del cliente. `organizationId`, `installationId` y `sourceSystem` se sobrescriben con el contexto autenticado server-side.

### `GET /v1/fiscal-records/{recordId}`

Consulta estado normalizado. Un tenant nunca puede leer registros de otro tenant; se responde `404` para no filtrar existencia.

### `POST /v1/webhooks/{profileId}`

Entrada low-code firmada. Requiere:

- `X-PV-Timestamp`;
- `X-PV-Signature: sha256=<HMAC>`;
- `Idempotency-Key` o `X-Event-Id`.

El secreto y el `MappingProfile` se resuelven exclusivamente en servidor.

## Handler

`createApiHandler()` es deliberadamente framework-neutral para poder montarlo después sobre Node HTTP, serverless, Fastify u otra capa sin cambiar el contrato de dominio.

Dependencias inyectadas:

- `authenticate(request)`;
- `resolveMappingProfile({ context, profileId })`;
- `resolveWebhookSecret({ context, profileId })`;
- `UniversalBridgeService`.

## Seguridad

La API no acepta tenant, credenciales AEAT, entorno fiscal ni permisos desde el payload. Una API key/credencial de conector es server-to-server y nunca debe exponerse al navegador.
