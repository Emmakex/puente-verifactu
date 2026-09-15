# Canonical Core v1

## Objetivo

`InvoiceIntent v1` es el contrato común entre cualquier sistema origen y el futuro motor fiscal. El mismo caso de factura debe producir el mismo objeto canónico venga de CSV, webhook, API, SDK o conector nativo.

No es todavía el XML de AEAT ni un registro de facturación fiscalizado. Esa separación es deliberada.

## InvoiceIntent v1

Campos de identidad:

- `schemaVersion = 1`;
- `operation = issue`;
- `organizationId`;
- `installationId`;
- `sourceSystem`;
- `sourceInvoiceId` estable;
- `series` y `number`.

Datos de factura:

- `issueDate` en `YYYY-MM-DD`;
- `invoiceType`: `F1`, `F2`, `F3`, `R1`…`R5`;
- `description`;
- `issuer`;
- `recipients[]`;
- `currency`;
- `taxBreakdown[]`;
- `adjustments[]` opcional;
- `totals`;
- datos de rectificación/sustitución cuando correspondan.

Los tipos de factura de v1 se mantienen alineados con la FAQ oficial de VERI*FACTU revisada en septiembre de 2026. La semántica fiscal completa se valida en fases posteriores y nunca se delega al conector.

## Dinero

Todo importe monetario viaja como **string decimal**, nunca como `float` binario. Ejemplos válidos: `100`, `100.00`, `-21.50`.

El núcleo usa enteros `BigInt` en céntimos para sumas y comparaciones del contrato v1.

## Totales derivados seguros

Para reducir configuración, cuando existen todas las líneas de desglose:

- `totals.baseAmount` puede derivarse de la suma de `taxBreakdown[].baseAmount`;
- `totals.taxAmount` puede derivarse de la suma de `taxBreakdown[].taxAmount`.

`totals.totalAmount` permanece explícito desde el sistema origen. Así el puente detecta retenciones, descuentos, recargos u otros ajustes en vez de inventarlos.

Los ajustes se expresan con importe firmado:

- retención: importe negativo;
- descuento: importe negativo;
- recargo: importe positivo;
- `other`: solo cuando el adaptador pueda describirlo y el motor fiscal lo admita.

## Destinatarios

`F2` puede no tener destinatario identificado. Para los demás tipos, v1 requiere al menos un destinatario con nombre y NIF o identificador extranjero.

El contrato soporta identificador extranjero con país, tipo (`02`…`06`) e identificador.

## Rectificativas

`R1`…`R5` requieren `rectification.type` con:

- `S`: sustitución;
- `I`: diferencias.

La lista de facturas rectificadas puede conservarse en `originalInvoices`. `F3` puede relacionar facturas simplificadas previas mediante `replacedInvoices`.

## MappingProfile v1

Un perfil contiene:

- columnas/campos de origen → rutas canónicas;
- transformaciones permitidas y explícitas;
- constantes de instalación;
- defaults no fiscales;
- opcionalmente `taxLineDefaults` para completar clasificación fiscal server-side cuando un conector nativo aporta varias líneas tributarias.

Transformaciones v1: `trim`, `upper`, `lower`, `decimal_comma`, `date_dmy`.

No hay expresiones arbitrarias ni JavaScript configurable: un mapping nunca debe convertirse en una vía para alterar invariantes o ejecutar código.

### Desglose multirate desde conectores nativos

Un perfil `sourceType: native` puede mapear un array de origen a `taxBreakdown`. Es útil para ecommerce como WooCommerce donde una misma operación puede contener varios tipos de IVA.

En esa ruta el sistema origen solo puede aportar hechos de cálculo:

- `rate`;
- `baseAmount`;
- `taxAmount`;
- `surchargeRate`;
- `surchargeAmount`.

El conector **no puede** introducir `taxCode`, `regimeKey` u `operationClass`. Esos tres campos deben existir en `MappingProfile.taxLineDefaults` y, por tanto, se resuelven server-side. La entrada está limitada a 12 líneas, coherente con el límite estructural del contrato canónico/adapter actual.

También se admite mapear `currency` desde el origen. La normalización puede convertirla a mayúsculas, pero un conector no calcula ni inventa conversiones a EUR; cuando sean necesarias, las exige el motor fiscal.

## Inferencia de cabeceras

El importador puede sugerir mapping para nombres habituales ES/EN (`Nº Factura`, `Fecha factura`, `NIF Cliente`, `Base imponible`, `Total`, etc.). La inferencia solo propone; el **preflight** decide si la muestra es válida.

## Preflight

`preflightRows()` es siempre `dry-run`:

1. aplica mapping;
2. normaliza transformaciones seguras;
3. deriva identidad/totales seguros;
4. valida estructura y consistencia;
5. devuelve errores ES/EN por fila.

No persiste, no fiscaliza y no llama a AEAT.

## Idempotencia

La identidad lógica incluye organización + instalación + sistema origen + identificador de factura + operación. La huella del contenido se calcula de forma canónica y excluye metadatos puramente operativos.

Misma identidad + mismo contenido → `duplicate`.

Misma identidad + contenido fiscal diferente → `conflict`.

## Persistencia de referencia

`InMemoryIntentStore` es una especificación ejecutable del comportamiento append-only, no almacenamiento productivo. La persistencia real mantiene exactamente el mismo contrato de duplicado/conflicto; el runtime single-node durable de Fase 4 usa SQLite detrás de interfaces de store inyectables.
