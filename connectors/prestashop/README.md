# Puente VeriFactu — PrestaShop connector v1

Conector nativo y deliberadamente fino para **PrestaShop 1.7.8.x y 8.x**. Su trabajo es extraer datos de una factura/pedido, construir un payload neutral y hablar con la API universal de Puente VeriFactu. **No contiene reglas AEAT, XML, SOAP, certificados ni decisiones fiscales sensibles.**

## Estado

Foundation v1 implementada en modo manual seguro, extractor fiscal reforzado y matriz real de compatibilidad validada:

- configuración por tienda para endpoint HTTPS y `MappingProfile` server-side;
- Bearer token cifrado localmente con AES-256-GCM usando una clave derivada de `_COOKIE_KEY_`;
- payload neutral de factura con número fiscal nativo, fecha, moneda, destinatario, totales y desglose por tipos;
- soporte de moneda extranjera delegando la conversión fiscal EUR al servidor;
- flujo manual `preflight -> issue -> reconcile` desde la configuración del módulo;
- idempotencia estable por tienda + pedido + número de factura;
- persistencia local mínima de `recordId`, estado y último error;
- aislamiento básico multitienda;
- gate CI contractual, sintaxis PHP 7.4, fixtures fiscales ejecutables y smoke con instalaciones reales de PrestaShop.

Todavía **no** activa envíos automáticos ni rectificativas. El siguiente gate es el paquete ZIP reproducible con instalación/upgrade smoke antes de continuar con UX operativa y rectificativas.

## Compatibilidad validada

La matriz real de CI instala el módulo dentro de tiendas efímeras PrestaShop Flashlight y valida una factura creada mediante la API nativa `Order::setInvoice()` antes de construir el payload del conector.

Combinaciones validadas el **15 de septiembre de 2026**:

- PrestaShop **1.7.8.11** / PHP **7.4**;
- PrestaShop **8.1.7** / PHP **8.1**;
- PrestaShop **8.2.7** / PHP **8.1**.

Cada job comprueba arranque real de la tienda, instalación y activación del módulo, creación de `pvf_order_sync`, carga de clases runtime, generación de una `OrderInvoice` nativa y construcción completa de `tax_lines` y totales desde esa factura. Esta matriz no implica soporte para PrestaShop 9.

## Principio de seguridad

PrestaShop nunca recibe el certificado AEAT. El certificado y la clave privada permanecen únicamente en el runtime seguro de Puente VeriFactu.

El módulo tampoco decide `invoiceType`, `taxCode`, `regimeKey`, `operationClass`, datos del emisor ni criterios de conversión fiscal. Todo ello pertenece al `MappingProfile` y a la configuración server-side.

## Fuente fiscal de la factura

El extractor **no reconstruye los impuestos leyendo directamente `order_detail`**. Usa las APIs nativas que PrestaShop emplea para su propia factura:

- `OrderInvoice::getProductTaxesBreakdown()` para productos y reparto de descuentos;
- `OrderInvoice::getShippingTaxesBreakdown()` para portes, incluido el caso de envío gratuito;
- `OrderInvoice::getWrappingTaxesBreakdown()` para embalaje/regalo;
- totales de la propia `OrderInvoice` para reconciliar base imponible y cuota.

Esto permite respetar el reparto que ya ha calculado PrestaShop y evita duplicar su motor de descuentos/redondeo dentro del conector. El resultado se agrupa por tipo y se reconcilia al céntimo con `total_paid_tax_excl` y `total_paid_tax_incl` antes de permitir el preflight.

Si PrestaShop no devuelve una fila para una base realmente al 0 %, el reconciliador puede completar únicamente ese residual sin cuota como línea `rate=0`. Si la cuota total difiere en más de un céntimo o la base extraída excede la factura, el conector bloquea la operación en lugar de inventar datos.

La ecotasa queda bloqueada en esta versión hasta definir un contrato fiscal explícito para ella. También se bloquean pedidos con múltiples facturas: el flujo actual por ID de pedido solo fiscaliza cuando existe una única `OrderInvoice`, evitando seleccionar silenciosamente la factura equivocada.

## Requisitos

- PrestaShop >= 1.7.8 y < 9.0 para esta primera matriz contractual.
- PHP 7.4+ para el gate inicial del repositorio; la matriz real valida las combinaciones indicadas arriba.
- extensiones PHP OpenSSL y cURL.
- endpoint Puente VeriFactu accesible mediante HTTPS.
- token Bearer y `MappingProfile` configurados en el servidor.
- debe existir una única factura fiscal de PrestaShop para el pedido en el flujo manual actual.

## Instalación de desarrollo

Copia `connectors/prestashop` como módulo `puenteverifactu` dentro de `modules/puenteverifactu/` y actívalo desde el gestor de módulos.

En **Configurar** introduce:

1. endpoint HTTPS del bridge;
2. ID del `MappingProfile`;
3. token Bearer;
4. timeout.

El token no vuelve a mostrarse después de guardarlo.

## Flujo manual v1

En el panel del módulo introduce el ID de pedido:

1. **Preflight only**: transforma y valida, sin crear registro fiscal ni enviar a AEAT.
2. **Create fiscal record**: vuelve a ejecutar preflight y, solo si pasa, crea el registro mediante `/v1/fiscal-records` con `Idempotency-Key`.
3. **Refresh status**: consulta `/v1/fiscal-records/{recordId}`.

Si ya existe `recordId`, el módulo bloquea la creación duplicada y obliga a reconciliar.

## Payload neutral

Ejemplo abreviado:

```json
{
  "connector_schema": 1,
  "source_invoice_id": "prestashop:1:invoice:456",
  "order_id": "123",
  "invoice_id": "456",
  "order_reference": "ABCDXYZ",
  "invoice_number": "#FA000123",
  "order_date": "2026-09-15",
  "currency": "EUR",
  "customer_name": "Cliente SL",
  "customer_tax_id": "B12345678",
  "total_amount": "121.00",
  "tax_lines": [
    { "rate": "21", "baseAmount": "100.00", "taxAmount": "21.00" }
  ]
}
```

El perfil de referencia está en `examples/mapping-profile.json`.

## Fixtures fiscales

`npm run prestashop:fixtures` ejecuta una matriz determinista que cubre:

- IVA simple;
- varios tipos de IVA;
- portes y wrapping agrupados por tipo;
- descuento global ya distribuido por PrestaShop;
- envío gratuito;
- mezcla de base gravada y residual al 0 %;
- operación completamente al 0 %;
- reconciliación de una diferencia de redondeo de un céntimo.

Los fixtures están en `fixtures/tax-breakdown-v1.json` y forman parte del CI obligatorio.

## Gate de instalación real

`scripts/ci/prestashop-compatibility-smoke.sh` usa PrestaShop Flashlight y MariaDB en contenedores efímeros. El smoke:

1. empaqueta temporalmente el módulo con raíz `puenteverifactu`;
2. arranca una tienda PrestaShop real;
3. auto-instala el módulo mediante el mecanismo de Flashlight;
4. valida versión de PrestaShop/PHP y que el módulo está activo;
5. comprueba la tabla local del conector;
6. crea una factura de prueba mediante la API nativa cuando el dataset no trae una;
7. construye el payload real y exige `tax_lines`, identidad fiscal, moneda y totales.

El ZIP utilizado aquí es únicamente un paquete temporal de CI. El ZIP reproducible de release y su gate de upgrade son el siguiente incremento separado.

## Límites conocidos

- no se fiscalizan automáticamente cambios de estado;
- no se procesan todavía abonos/rectificativas;
- no hay todavía semáforo dentro de la ficha nativa del pedido;
- pedidos con varias facturas quedan bloqueados hasta añadir selección explícita por `OrderInvoice`;
- ecotasa queda bloqueada hasta disponer de mapping fiscal específico;
- PrestaShop 9 no está declarado compatible y se evaluará explícitamente antes de incorporarlo.

## Siguiente incremento

1. paquete ZIP reproducible e instalación/upgrade smoke;
2. integración del estado en la ficha de pedido;
3. rectificativas/abonos idempotentes;
4. automatización opt-in después de validar el flujo manual.
