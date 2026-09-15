# Modelo de dominio y contrato API

## Principio

Los conectores no envían XML AEAT. Producen un **modelo canónico versionado**. Solo el adaptador AEAT construye o interpreta formatos oficiales.

La especificación canónica está en [`canonical-core-v1.md`](canonical-core-v1.md) y `packages/contracts/schemas/`. La primera superficie ejecutable de integración está documentada en [`universal-integration-kit-v1.md`](universal-integration-kit-v1.md).

## Entidades principales

### Organization

Representa al obligado/cliente y su configuración fiscal. Certificados y secretos quedan fuera de payloads de negocio.

### Installation

Instancia lógica de una integración para una organización. Separa fuentes, secuencias, configuración e idempotencia.

### MappingProfile

Traduce el vocabulario del sistema origen a rutas del contrato canónico mediante operaciones limitadas y auditables. Es versionado y portable.

### InvoiceIntent v1

Entrada normalizada del sistema origen. Incluye identidad estable, datos de factura, emisor/destinatarios, desglose, ajustes y totales. Los importes son strings decimales exactos.

Los tipos v1 son `F1`, `F2`, `F3`, `R1`, `R2`, `R3`, `R4` y `R5`.

### FiscalRecord

Representación inmutable resultante de fiscalización: tipo de registro, material normalizado, huella, encadenamiento, versión del motor y datos necesarios para transmisión.

### DeliveryAttempt

Cada intento de entrega conserva estado normalizado, códigos AEAT y metadatos operativos sin exponer secretos. La persistencia durable de intentos pertenece al hardening posterior.

## Identidad y autorización

La API es **server-authoritative**. El contexto autenticado resuelve como mínimo:

- `organizationId`;
- `installationId`;
- `sourceSystem`.

Cualquier valor equivalente enviado por el cliente se sobrescribe. El payload nunca selecciona tenant, certificado, entorno AEAT ni permisos.

## Endpoints v1

### `POST /v1/preflight`

Validación sin efectos.

Modo canónico:

```json
{ "intent": { "sourceInvoiceId": "..." } }
```

Modo mapeado:

```json
{
  "profileId": "erp-cliente-v1",
  "source": { "NUM_FACTURA": "2026-100" }
}
```

### `POST /v1/fiscal-records`

Cabeceras:

- autenticación server-to-server;
- `Idempotency-Key` obligatoria;
- `X-Connector-Version` recomendada.

Acepta modo canónico o mapeado igual que preflight.

Respuesta inicial:

```json
{
  "recordId": "fr_...",
  "status": "fiscalized",
  "sourceInvoiceId": "...",
  "duplicate": false
}
```

Si existe una cola de entrega inyectada, `status` puede ser `queued` u otro estado normalizado.

### `GET /v1/fiscal-records/{recordId}`

Devuelve estado normalizado y nunca secretos. Si el recurso existe en otro tenant se responde `404` para no filtrar su existencia.

### `POST /v1/webhooks/{profileId}`

Entrada low-code firmada con HMAC-SHA256. Requiere timestamp anti-replay y `Idempotency-Key` o `X-Event-Id`.

## Idempotencia

La capa HTTP reserva `organization + installation + Idempotency-Key`.

- misma clave + mismo contenido: devuelve el mismo recurso;
- misma clave + contenido distinto: `409 VF_API_IDEMPOTENCY_CONFLICT`;
- una operación fallida libera la reserva para permitir un reintento legítimo.

La capa fiscal conserva además su propia idempotencia por identidad de factura/origen.

## Errores

Formato estable:

```json
{
  "error": {
    "code": "VF_API_VALIDATION_FAILED",
    "message": "InvoiceIntent validation failed",
    "retryable": false,
    "correlationId": "...",
    "details": []
  }
}
```

El `correlationId` se devuelve en JSON y en `X-Correlation-Id`.

## Webhooks

Firma:

```text
HMAC-SHA256(secret, "<unix_timestamp>.<raw_body>")
```

Cabeceras:

- `X-PV-Timestamp`;
- `X-PV-Signature: sha256=<hex>`;
- `Idempotency-Key` o `X-Event-Id`.

La ventana anti-replay por defecto es de 300 segundos. El secreto y el perfil se resuelven server-side.

## Datos monetarios

No usar `float` binario para cálculos fiscales. En v1 los importes viajan como strings decimales y se comparan internamente con `BigInt` en céntimos.
