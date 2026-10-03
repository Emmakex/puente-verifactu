# Presentación VERI*FACTU — QR tributario v1

El core expone un contrato determinista para que cualquier conector pueda representar correctamente los elementos VERI*FACTU de la factura sin duplicar reglas regulatorias.

## Fuente técnica fijada

- AEAT — “Detalle de las especificaciones técnicas del código QR de la factura y de la URL del servicio de cotejo o remisión de información por parte del receptor de la factura”.
- Versión: `0.5.0`.
- Fecha: `2025-12-10`.
- Orden HAC/1177/2024, artículos 20 y 21.

## Contrato

`buildVerifactuInvoicePresentation(...)` devuelve:

- URL de cotejo AEAT para `test` o `production`;
- literal previo `QR tributario:`;
- literal VERI*FACTU: `Factura verificable en la sede electrónica de la AEAT`;
- nivel de corrección QR `M`;
- tamaño admitido 30–40 mm;
- zona blanca mínima 2 mm y recomendada 6 mm;
- indicación de posición preeminente en la primera página;
- obligación de incluir la URL como campo independiente en factura electrónica estructurada.

La URL contiene exclusivamente los cuatro parámetros obligatorios `nif`, `numserie`, `fecha` e `importe`, más `idioma` solo cuando se solicita un idioma admitido. Nunca se incorpora `formato=json` al QR.

## Regla de arquitectura

Los conectores deben consumir este contrato. No deben reconstruir por su cuenta la URL, textos o dimensiones regulatorias.
