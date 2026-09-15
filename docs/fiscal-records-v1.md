# Fiscal Records & Hash v1

## Alcance

Fase 2 convierte un `InvoiceIntent v1` validado en un registro fiscal interno inmutable de **alta** o **anulación**, calcula su huella AEAT y lo encadena con el registro inmediatamente anterior del mismo SIF.

Este modelo todavía **no es el XML de remisión AEAT**. La serialización XML, XSD/WSDL, certificados y transporte pertenecen a la Fase 3.

## Fuente normativa y técnica

Implementación contrastada el 15-09-2026 contra:

- Real Decreto 1007/2023: https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840
- Orden HAC/1177/2024, especialmente artículos 7 y 13: https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138
- AEAT — algoritmo de cálculo/codificación de huella: https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica/algoritmo-calculo-codificacion-huella-hash.html
- Documento técnico AEAT `Veri-Factu_especificaciones_huella_hash_registros.pdf`, versión 0.1.2.

Antes de cada release certificable se volverá a comprobar la versión publicada por AEAT.

## Algoritmo

`TipoHuella = 01` corresponde a SHA-256.

La cadena se codifica como UTF-8 y el resultado se expresa en hexadecimal **mayúsculo de 64 caracteres**.

### Alta

Orden exacto:

1. `IDEmisorFactura`
2. `NumSerieFactura`
3. `FechaExpedicionFactura`
4. `TipoFactura`
5. `CuotaTotal`
6. `ImporteTotal`
7. `Huella` del registro anterior, o vacío si es el primero
8. `FechaHoraHusoGenRegistro`

Formato:

```text
IDEmisorFactura=...&NumSerieFactura=...&FechaExpedicionFactura=...&TipoFactura=...&CuotaTotal=...&ImporteTotal=...&Huella=...&FechaHoraHusoGenRegistro=...
```

### Anulación

Orden exacto:

1. `IDEmisorFacturaAnulada`
2. `NumSerieFacturaAnulada`
3. `FechaExpedicionFacturaAnulada`
4. `Huella` del registro anterior
5. `FechaHoraHusoGenRegistro`

## Tratamiento de datos

- `issueDate` canónico `YYYY-MM-DD` se transforma a `DD-MM-YYYY` solo para material AEAT.
- Se eliminan espacios únicamente en los extremos de los valores usados en el hash.
- Los ceros no significativos a la derecha de decimales se normalizan según la especificación AEAT (`123.10` y `123.1` producen el mismo material).
- `series + number` forma `NumSerieFactura` sin inventar separadores. El conector debe conservar en esos campos la representación estable que corresponda al sistema origen.
- Los registros usan timestamp con segundos y offset explícito, por ejemplo `2026-09-15T10:00:00+02:00`.
- El helper de tiempo exige una zona IANA configurada en el SIF (`Europe/Madrid`, `Atlantic/Canary`, etc.); no toma silenciosamente la zona horaria del servidor.

## Cadena

La cadena **no se separa por WooCommerce, CSV, API o ERP**. Los conectores son fuentes de entrada reemplazables.

La clave lógica es:

```text
organizationId + sif.systemId + sif.installationNumber
```

Por tanto, todos los registros de un mismo obligado generados por una misma instalación lógica del SIF forman una única cadena, incluyendo altas y anulaciones.

Cada registro conserva referencia al anterior:

- NIF emisor;
- número/serie de factura;
- fecha de expedición;
- huella de 64 caracteres.

El primer registro se marca con `firstRecord = true` y usa `Huella=` vacía para construir su propio hash.

## Concurrencia

`FiscalRecordService` serializa la sección crítica por cadena. Dos facturas procesadas simultáneamente no pueden leer el mismo registro anterior y crear dos ramas.

`MemoryFiscalRecordStore` es una implementación ejecutable de referencia para tests y desarrollo. La persistencia productiva deberá implementar la misma transacción mediante bloqueo/serialización en almacenamiento durable antes del piloto real.

## Idempotencia

Un reintento del mismo evento de emisión devuelve el registro ya generado. Si llega la misma identidad idempotente con contenido fiscal distinto se bloquea con `VF_FISCAL_IDEMPOTENCY_CONFLICT`.

La anulación exige `sourceCancellationId` para distinguir un reintento de una nueva operación.

## Moneda

El RRSIF exige importes del registro en euros. Para `InvoiceIntent.currency = EUR` se utilizan los importes canónicos. Para otra moneda, el núcleo exige que una capa anterior entregue explícitamente `quotaTotal` e `totalAmount` ya convertidos a EUR; nunca inventa un tipo de cambio.

## Fixtures oficiales

El CI incorpora como pruebas de regresión los tres ejemplos publicados por AEAT:

1. primer registro de alta;
2. segundo registro de alta encadenado;
3. registro de anulación encadenado.

Los hashes esperados se copian literalmente del documento oficial. Cualquier diferencia de un solo byte rompe el test.

## Límites de esta fase

No se considera implementado todavía:

- XML AEAT;
- XSD/WSDL;
- transporte al servicio web;
- certificado de pruebas/producción;
- QR;
- persistencia SQL/productiva;
- conversiones de divisa automáticas;
- declaración responsable de una release productiva.
