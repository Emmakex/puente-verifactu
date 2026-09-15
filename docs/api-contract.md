# Modelo de dominio y contrato API

## Principio

Los conectores no envían XML AEAT. Envían un **modelo canónico versionado**. Solo el adaptador AEAT puede construir o interpretar formatos oficiales.

## Entidades principales

### Organization

Representa al obligado/cliente y su configuración fiscal. Campos sensibles, certificados y secretos se almacenan fuera de payloads de negocio.

### Installation

Instancia de un conector/SIF para una organización. Permite separar fuentes, versiones, secuencias y diagnóstico.

### InvoiceIntent

Entrada normalizada del sistema origen. Contiene, como mínimo cuando aplique:

- `organizationId`
- `installationId`
- `sourceSystem`
- `sourceInvoiceId`
- `series`
- `number`
- `issueDate`
- `invoiceType`
- emisor y destinatario
- líneas/base/impuestos/cuotas/totales
- moneda
- indicadores y claves fiscales necesarias
- referencia a factura previa cuando la operación lo requiera

### FiscalRecord

Representación inmutable resultante: tipo de registro, material normalizado, huella, referencia al registro previo, timestamp técnico, versión del motor y artefactos de transmisión.

### DeliveryAttempt

Cada intento de envío conserva número de intento, timestamps, endpoint lógico, resultado normalizado, códigos AEAT y referencia al payload exacto enviado.

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

## Idempotencia

La clave lógica mínima debe impedir que una misma factura del mismo origen produzca dos altas por reintento. La combinación concreta se documentará en el schema, pero deberá incluir tenant + instalación/origen + identificador estable + tipo de operación.

Si una petición se repite con la misma clave y mismo contenido, devuelve el recurso existente. Si usa la misma clave con contenido distinto, responde conflicto y no modifica el registro.

## Errores

Formato estable:

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

Categorías mínimas: `AUTH`, `VALIDATION`, `CONFLICT`, `FISCALIZATION`, `AEAT_REJECTED`, `AEAT_UNAVAILABLE`, `CERTIFICATE`, `RATE_LIMIT`, `INTERNAL`.

## Webhooks

Los webhooks son opcionales para el conector. Deben estar firmados, ser reintentables, ordenables por secuencia y contener un `eventId` idempotente. El consumidor siempre puede reconciliar por polling.

## Datos monetarios

No usar `float` binario para cálculos fiscales. Los importes se representan con decimal exacto o enteros escalados y reglas de redondeo explícitas.
