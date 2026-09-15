# Puente VeriFactu SDK

SDK mínimo para integrar software de terceros con Puente VeriFactu sin conocer SOAP, XML AEAT ni detalles de transporte fiscal.

## Uso previsto

**Server-side only.** La API key del conector nunca debe llegar al navegador, una app pública ni al contexto de un modelo.

```js
import { PuenteVerifactuClient } from './src/client.mjs';

const client = new PuenteVerifactuClient({
  baseUrl: 'https://bridge.example.com',
  apiKey: process.env.PUENTE_VERIFACTU_API_KEY,
  connectorVersion: 'mi-erp/1.0.0',
});

const check = await client.preflight({
  sourceInvoiceId: 'INV-1001',
  number: '1001',
  issueDate: '2026-09-15',
  invoiceType: 'F2',
  description: 'Servicio',
  issuer: { name: 'Empresa', taxId: '...' },
  currency: 'EUR',
  taxBreakdown: [
    {
      taxCode: '01',
      regimeKey: '01',
      operationClass: 'S1',
      rate: '21',
      baseAmount: '100.00',
      taxAmount: '21.00',
    },
  ],
  totals: { baseAmount: '100.00', taxAmount: '21.00', totalAmount: '121.00' },
});
```

`organizationId`, `installationId`, `sourceSystem`, entorno fiscal y credenciales se resuelven en el servidor. El conector no puede concederse a sí mismo permisos ni cambiar de tenant mediante el payload.

## Métodos v1

- `preflight(intent)` — validación sin efectos.
- `preflightMapped(profileId, source)` — aplica un `MappingProfile` guardado en servidor.
- `issue(intent, { idempotencyKey })` — crea/fiscaliza una operación idempotente.
- `issueMapped(profileId, source, { idempotencyKey })` — integración low-code mediante perfil de mapeo.
- `getFiscalRecord(recordId)` — consulta el estado normalizado.

Los errores de API se convierten en `PuenteVerifactuError` con `code`, `status`, `retryable`, `correlationId` y `details`.
