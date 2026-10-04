# API / Webhook lifecycle v1

Ejemplos genéricos para integrar un ERP, CRM, SaaS o software propio con Kairoseth Fiscal / Puente VeriFactu.

Estos ejemplos describen **datos de origen**, no reglas fiscales. El sistema origen no decide tenant, instalación, NIF emisor, entorno AEAT, clasificación fiscal ni credenciales. Esas decisiones permanecen en Kairoseth y en el `MappingProfile` server-side.

## 1. Create

Ruta:

```http
POST /v1/fiscal-records
Idempotency-Key: <stable-event-id>
Authorization: Bearer <kairoseth-data-plane-token>
Content-Type: application/json
```

Body: `create.json`.

La credencial Kairoseth está scopeada al `profileId`. La respuesta contiene `recordId`, estado y presentación VERI*FACTU/QR; nunca XML AEAT crudo.

## 2. Status

Ruta:

```http
GET /v1/fiscal-records/{recordId}/status
Authorization: Bearer <same-integration-token>
```

Respuesta estable:

```json
{
  "schemaVersion": 1,
  "recordId": "fr_...",
  "operation": "issue",
  "status": "fiscalized",
  "integrationProfileId": "int_...",
  "sourceInvoiceId": "erp:invoice:2026-100",
  "presentation": {
    "mode": "VERI*FACTU",
    "qr": {
      "url": "https://..."
    }
  },
  "delivery": null
}
```

`delivery` solo expone estado operacional sanitizado. No devuelve requests/responses SOAP, XML fiscal ni secretos.

## 3. Cancel

Ruta:

```http
POST /v1/fiscal-records/{recordId}/cancel
Idempotency-Key: <stable-cancellation-event-id>
Authorization: Bearer <same-integration-token>
Content-Type: application/json
```

Body: `cancel.json`.

El cliente envía **únicamente** `sourceCancellationId`. Kairoseth deriva del registro original el NIF emisor, número fiscal y fecha. Un payload que intente enviar identidad fiscal es rechazado.

La cancelación crea otro `recordId`; puede consultarse con el mismo endpoint `/status`.

## 4. Rectification

Ruta:

```http
POST /v1/fiscal-records
Idempotency-Key: <stable-rectification-event-id>
Authorization: Bearer <kairoseth-data-plane-token>
Content-Type: application/json
```

Body: `rectification.json`.

Debe utilizarse un IntegrationProfile/MappingProfile correctivo separado. El origen aporta hechos como referencia de la factura original e importes; el MappingProfile server-side decide la clasificación correctiva permitida (R1–R5 y S/I). No debe copiarse esa lógica al ERP, webhook o starter kit.

## 5. Webhook

Ruta:

```http
POST /v1/webhooks/{profileId}
Authorization: Bearer <kairoseth-data-plane-token>
X-PV-Timestamp: <unix-seconds>
X-PV-Signature: sha256=<hmac>
X-Event-Id: <stable-event-id>
Content-Type: application/json
```

Body: `webhook-event.json`.

El secreto HMAC se resuelve desde Kairoseth mediante referencia opaca; no vive en el IntegrationProfile ni en estos ejemplos.

## Scope y seguridad

Para credenciales dinámicas Kairoseth, cada recurso queda ligado a:

- `organizationId`;
- `installationId`;
- `sourceSystem`;
- `integrationProfileId`.

Una credencial no puede leer, cancelar ni consultar el estado de un registro de otra instalación/perfil, incluso dentro de la misma organización.

Los canales API y Webhook comparten el mismo pipeline:

```text
source -> MappingProfile -> InvoiceIntent -> preflight -> idempotency
       -> fiscal core -> delivery/reconciliation -> presentation/status
```
