# Conversión fiscal EUR v1

Puente VeriFactu conserva la moneda e importes comerciales del sistema origen, pero **solo fiscaliza y remite a AEAT una vista monetaria en EUR**.

## Principios

- El conector no decide el tipo de cambio.
- El tipo de cambio se resuelve server-side por organización + instalación + moneda + fecha.
- La fecha v1 usada para seleccionar el cambio es `InvoiceIntent.issueDate`.
- El cambio debe registrar fuente y referencia auditable.
- Los cálculos usan decimal exacto con `BigInt`; nunca `float`.
- El redondeo monetario es a céntimos, half-up.
- Si el redondeo por líneas no reconcilia con los totales, el preflight bloquea; nunca se mueve un céntimo silenciosamente.
- Para esos casos puede configurarse una excepción por `sourceInvoiceId` con importes fiscales EUR explícitos y auditados.
- La clasificación fiscal (`invoiceType`, régimen, calificación, tipo impositivo, etc.) no cambia durante la conversión.
- Hash y XML AEAT se generan únicamente desde la vista fiscal EUR.

## Contrato server-side

Las conversiones viven en el mismo fichero externo de `PV_INTEGRATION_CONFIG_PATH`:

```json
{
  "integrations": [],
  "euroConversions": [
    {
      "organizationId": "org-001",
      "installationId": "woocommerce-001",
      "sourceCurrency": "USD",
      "rateDate": "2026-09-15",
      "eurPerUnit": "0.85",
      "rateSource": "BANCO_DE_ESPANA",
      "reference": "BDE:USD:2026-09-15"
    }
  ]
}
```

`eurPerUnit` significa **EUR por una unidad de la moneda origen**. No se acepta `EUR` como moneda origen ni un tipo cero/negativo.

## Reconciliación por factura

Si la conversión exacta de cada línea produce una diferencia de céntimos respecto al total convertido, se configura una entrada más específica para el `sourceInvoiceId`:

```json
{
  "organizationId": "org-001",
  "installationId": "woocommerce-001",
  "sourceCurrency": "USD",
  "rateDate": "2026-09-15",
  "sourceInvoiceId": "woo:order:900",
  "eurPerUnit": "0.85",
  "rateSource": "BANCO_DE_ESPANA",
  "reference": "BDE:USD:2026-09-15:ORDER-900",
  "fiscalAmounts": {
    "taxBreakdown": [
      { "baseAmount": "85.00", "taxAmount": "17.85" }
    ],
    "totals": {
      "baseAmount": "85.00",
      "taxAmount": "17.85",
      "totalAmount": "102.85"
    }
  }
}
```

La excepción por factura tiene prioridad sobre la tarifa genérica del mismo día.

## Preflight

Para una factura no-EUR:

1. se conserva el `sourcePreview` en moneda original;
2. el servidor localiza el cambio aplicable;
3. se construye `preview` en EUR;
4. se valida de nuevo todo el `InvoiceIntent` fiscal;
5. si falta cambio o no cuadran los importes, `ok=false` y no existe fiscalización.

El resultado expone `currencyConversion` sin secretos y con fuente, referencia, fecha, tipo e importes total origen/fiscal.

## Persistencia e idempotencia

El recurso fiscal durable conserva:

- `sourceCurrency`;
- `fiscalCurrency=EUR`;
- `currencyConversion` auditable;
- `FiscalRecord` con importes EUR.

La conversión forma parte de la huella de idempotencia de la API. La misma clave con otro cambio produce conflicto y no modifica el registro anterior.

## Alcance v1

La selección automática usa `issueDate`. Si un caso fiscal requiere una fecha de devengo distinta, debe incorporarse al contrato canónico antes de automatizar ese supuesto; no se inferirá desde datos no autoritativos del conector.

La obtención automática de tipos oficiales desde proveedores externos queda separada del contrato de conversión: el motor acepta únicamente tipos ya resueltos y auditables en servidor.
