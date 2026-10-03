# Neutralidad de versión de conectores

Puente VeriFactu sigue una estrategia **capability-first**: el runtime no decide su comportamiento mediante ramas del tipo “si PrestaShop es X” o “si WooCommerce es Y”.

## Regla

- el core fiscal y la API son independientes del ecommerce;
- los conectores usan APIs públicas y capacidades detectables;
- la matriz CI indica qué versiones han sido probadas, pero no se usa para activar/desactivar lógica;
- una versión futura que conserve las capacidades necesarias puede funcionar sin modificar el core;
- si una capacidad imprescindible para una factura conforme no existe, el conector falla cerrado antes de la emisión en vez de inventar un comportamiento.

## PrestaShop

El módulo detecta hooks y renderer QR en runtime. Los hooks disponibles se registran dinámicamente mediante `PVFPrestaShopCompatibility`.

La representación nativa PDF requiere dos capacidades:

1. hook `displayPDFInvoice`;
2. un renderer QR TCPDF disponible en el runtime.

Si faltan, el módulo puede seguir instalado y usarse para diagnóstico/preflight, pero la emisión ordinaria queda bloqueada hasta disponer de una representación compatible. Esto evita ligar el conector a un número concreto de versión.

La matriz de CI sigue siendo conservadora y solo constituye evidencia de las combinaciones realmente ejecutadas.

## WooCommerce

WooCommerce no dispone de un único motor de factura PDF universal. Por ello Puente no depende de ningún plugin PDF concreto.

Tras fiscalizar, el conector guarda mediante WooCommerce CRUD un contrato neutral de presentación y lo expone mediante:

- `pv_woo_get_invoice_presentation($order)`;
- filtro `pv_woo_invoice_presentation`;
- acción `pv_woo_invoice_presentation_updated`.

Cualquier generador de factura puede consumir esos metadatos y renderizar QR/textos sin duplicar reglas AEAT. El conector no usa acceso directo a tablas de pedidos y mantiene compatibilidad HPOS.

## Gate CI

`npm run connectors:neutrality` impide introducir:

- ramas de runtime basadas en versiones de PrestaShop/WooCommerce;
- dependencias directas de proveedores PDF de WooCommerce;
- pérdida de la capa de capacidades PrestaShop;
- pérdida de la API neutral de presentación WooCommerce.
