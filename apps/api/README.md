# API application

Superficie HTTP/framework-neutral del puente. Se limita a autenticación, autorización, parsing, idempotencia y orquestación hacia `core`; no duplica reglas fiscales.

## Endpoints v1

### `POST /v1/imports/inspect`

Entrada para el wizard CSV/XLSX. El body contiene los bytes crudos del archivo.

Cabeceras:

- `X-File-Name`: nombre URI-encoded;
- `X-Sheet`: hoja opcional;
- `X-Header-Row`: fila de cabecera opcional;
- `Accept-Language`: `es` o `en`.

Devuelve una sesión temporal `imp_...`, metadatos del archivo, muestra de filas y el informe de Mapping Assistant. No fiscaliza ni contacta con AEAT.

### `POST /v1/imports/{importId}/preflight`

Recibe confirmaciones/overrides permitidos y configuración fija del negocio. Construye el `MappingProfile` server-side y ejecuta `preflightRows` sin efectos.

La sesión está aislada por organización + instalación y tiene TTL.

### `POST /v1/imports/{importId}/issue`

Emisión explícita por lotes para CSV/XLSX. Reutiliza las mismas confirmaciones, overrides y configuración del preflight. Antes de emitir vuelve a validar **todas** las filas y falla cerrado con `VF_IMPORT_BATCH_PREFLIGHT_FAILED` si existe cualquier fila inválida; en ese caso no se fiscaliza ninguna.

Cada fila válida usa una clave de idempotencia estable `importId:row:<n>`, de modo que una repetición del lote puede reconciliar filas ya creadas sin duplicarlas. La respuesta devuelve `recordId`, estado y flag `duplicate` por fila.

### `DELETE /v1/imports/{importId}`

Elimina explícitamente la sesión temporal de importación.

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

Consulta el recurso fiscal. Un tenant nunca puede leer registros de otro tenant; una credencial dinámica Kairoseth queda además limitada a su instalación + IntegrationProfile + sourceSystem. Se responde `404` para no filtrar existencia.

### `GET /v1/fiscal-records/{recordId}/status`

Devuelve un envelope machine-readable común para API/Webhook/conectores:

- operación: `issue`, `rectification` o `cancel`;
- estado normalizado;
- identificadores de origen;
- IntegrationProfile;
- identidad fiscal mínima del registro;
- presentación VERI*FACTU/QR cuando corresponde;
- resumen sanitizado de delivery/reconciliación.

No expone XML/SOAP AEAT, requests crudos, responses crudos ni secretos.

### `POST /v1/fiscal-records/{recordId}/cancel`

Cancela un registro de alta utilizando el mismo core fiscal. Requiere `Idempotency-Key`.

Body permitido:

```json
{
  "sourceCancellationId": "erp:cancellation:2026-100"
}
```

El cliente **no puede enviar** NIF emisor, número fiscal, serie ni fecha. Esa identidad se deriva del registro original ya persistido. La cancelación crea un nuevo `recordId` y se consulta mediante el mismo contrato `/status`.

### `POST /v1/webhooks/{profileId}`

Entrada low-code firmada. Requiere:

- `X-PV-Timestamp`;
- `X-PV-Signature: sha256=<HMAC>`;
- `Idempotency-Key` o `X-Event-Id`.

El secreto y el `MappingProfile` se resuelven exclusivamente en servidor.

## Lifecycle API/Webhook

Los ejemplos genéricos están en `examples/api-lifecycle/`:

- `create.json`;
- `cancel.json`;
- `rectification.json`;
- `webhook-event.json`;
- `README.md`.

La rectificación utiliza un MappingProfile correctivo server-side. El origen aporta hechos e importes, pero no decide R1–R5, S/I ni otras reglas AEAT.

Las credenciales dinámicas de Kairoseth están scopeadas al IntegrationProfile. No pueden enviar un InvoiceIntent canónico sin profileId, acceder a file-import ni consultar/cancelar recursos de otro perfil.

## Handler

`createApiHandler()` es deliberadamente framework-neutral para poder montarlo después sobre Node HTTP, serverless, Fastify u otra capa sin cambiar el contrato de dominio.

Dependencias inyectadas:

- `authenticate(request)`;
- `resolveMappingProfile({ context, profileId })`;
- `resolveWebhookSecret({ context, profileId })`;
- `ImportSessionService` opcional para onboarding;
- `UniversalBridgeService`.

## Importaciones temporales

La implementación de referencia conserva únicamente las filas ya parseadas y metadatos necesarios para el preflight. No conserva el binario original.

Valores por defecto:

- fichero máximo: 5 MiB;
- TTL: 15 minutos;
- máximo: 100 sesiones en memoria;
- respuesta de preflight: hasta 200 filas de detalle.

El almacenamiento en memoria debe sustituirse por un store temporal compartido antes de desplegar múltiples réplicas.

## Seguridad

La API no acepta tenant, credenciales AEAT, entorno fiscal ni permisos desde el payload. Una API key/credencial de conector es server-to-server y nunca debe exponerse al navegador.

Las rutas de onboarding usan la sesión autenticada del usuario. Los mappings manuales y constantes configurables están limitados por allowlists server-side.
