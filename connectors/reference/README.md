# Reference connector

Conector mínimo de referencia y especificación ejecutable para terceros. Sirve como plantilla para cualquier ERP, CRM, ecommerce o software propio sin depender de una plataforma comercial.

## Objetivo

Demostrar el contrato mínimo de un conector:

1. mantener un identificador estable de evento/factura;
2. enviar datos del sistema origen;
3. usar un `MappingProfile` configurado en Puente VeriFactu;
4. ejecutar preflight antes de producción;
5. enviar con idempotencia;
6. consultar el estado normalizado.

El conector **no** conoce XML AEAT, hashes fiscales, certificados ni tenant IDs internos.

## Uso conceptual

```js
import { PuenteVerifactuClient } from '../../packages/sdk/src/client.mjs';
import { ReferenceConnector } from './src/reference-connector.mjs';

const client = new PuenteVerifactuClient({
  baseUrl: process.env.PUENTE_VERIFACTU_URL,
  apiKey: process.env.PUENTE_VERIFACTU_API_KEY,
  connectorVersion: 'mi-conector/1.0.0',
});

const connector = new ReferenceConnector({
  client,
  profileId: 'erp-cliente-v1',
  sourceName: 'mi-erp',
});

await connector.preflight({ NUM_FACTURA: '2026-100' });
const created = await connector.send(
  { NUM_FACTURA: '2026-100' },
  { eventId: 'invoice-created-2026-100' },
);
await connector.status(created.recordId);
```

Este patrón es la base para los futuros conectores WooCommerce, PrestaShop y ERP/CRM.
