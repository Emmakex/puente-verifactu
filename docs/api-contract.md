# Modelo de dominio y contrato API

## Principio

Los conectores no envían XML AEAT. Producen un **modelo canónico versionado**. Solo el adaptador AEAT podrá construir o interpretar formatos oficiales.

La especificación ejecutable de Fase 1 está en [`canonical-core-v1.md`](canonical-core-v1.md) y en `packages/contracts/schemas/`.

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

Se implementará en Fase 2. Será la representación inmutable resultante de fiscalización: tipo de registro, material normalizado, huella, encadenamiento, versión del motor y artefactos de transmisión.

### DeliveryAttempt

Se implementará con el adaptador AEAT. Cada intento conservará timestamps, resultado normalizado, códigos AEAT y referencia al payload exacto.

## Endpoint conceptual

`POST /v1/fiscal-records`

Cabeceras:

- autenticación server-to-server;
- `Idempotency-Key` obligatoria;
- `X-Connector-Version`.

Respuesta inicial sugerida:

```json
{
  "recordId": "fr_...",
  "status": "queued",
  "sourceInvoiceId": "...",
  "duplicate": false
}
```

`GET /v1/fiscal-records/{recordId}` devuelve estado normalizado y nunca secretos.

La superficie HTTP no se considera implementada hasta Fase 4; Fase 1 define el comportamiento de dominio que dicha API deberá respetar.

## Idempotencia

La clave lógica v1 combina tenant + instalación + sistema origen + `sourceInvoiceId` + operación. La misma clave con la misma huella devuelve el recurso existente; la misma clave con contenido fiscal diferente genera conflicto y nunca sobrescribe el anterior.

## Errores

Formato estable previsto:

```json
{
  "error": {
    "code": "VF_VALIDATION_...",
    "message": "...",
    "retryable": false,
    "correlationId": "...",
    "details": []
  }
}
```

La validación de dominio ya devuelve códigos estables y mensajes ES/EN. Categorías de API previstas: `AUTH`, `VALIDATION`, `CONFLICT`, `FISCALIZATION`, `AEAT_REJECTED`, `AEAT_UNAVAILABLE`, `CERTIFICATE`, `RATE_LIMIT`, `INTERNAL`.

## Webhooks

Los webhooks serán opcionales. Deberán estar firmados, ser reintentables y usar `eventId` idempotente. El consumidor podrá reconciliar siempre mediante polling.

## Datos monetarios

No usar `float` binario para cálculos fiscales. En v1 los importes viajan como strings decimales y se comparan internamente con `BigInt` en céntimos.
