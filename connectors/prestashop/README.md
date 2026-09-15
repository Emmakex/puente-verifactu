# Puente VeriFactu — PrestaShop connector 0.2.0

Conector nativo y deliberadamente fino para **PrestaShop 1.7.8.x y 8.x**. Su trabajo es extraer datos de una factura/pedido, construir un payload neutral y hablar con la API universal de Puente VeriFactu. **No contiene reglas AEAT, XML, SOAP, certificados ni decisiones fiscales sensibles.**

## Estado

Versión `0.2.0` validada con flujo manual seguro, extractor fiscal reforzado, paquete reproducible y estado operativo dentro de la ficha nativa del pedido:

- configuración por tienda para endpoint HTTPS y `MappingProfile` server-side;
- Bearer token cifrado localmente con AES-256-GCM usando una clave derivada de `_COOKIE_KEY_`;
- payload neutral de factura con número fiscal nativo, fecha, moneda, destinatario, totales y desglose por tipos;
- soporte de moneda extranjera delegando la conversión fiscal EUR al servidor;
- flujo manual `preflight -> issue -> reconcile`;
- idempotencia estable por tienda + pedido + número de factura;
- persistencia local mínima de `recordId`, estado y último error;
- aislamiento básico multitienda;
- semáforo verde/ámbar/rojo/gris en la ficha nativa del pedido;
- gate CI contractual, fixtures fiscales y smoke con instalaciones reales;
- ZIP reproducible con allowlist de runtime, SHA-256 y layout compatible con instaladores legacy;
- upgrade real `0.1.0 → 0.2.0` preservando estado local y registrando el hook operativo.

Todavía **no** activa envíos automáticos ni procesa abonos/rectificativas. El siguiente incremento es precisamente el flujo rectificativo idempotente con un perfil fiscal separado.

## Compatibilidad validada

La matriz real de CI instala el **ZIP reproducible de distribución** dentro de tiendas efímeras PrestaShop Flashlight y valida una factura creada mediante la API nativa `Order::setInvoice()` antes de construir el payload del conector.

Combinaciones validadas el **15 de septiembre de 2026**:

- PrestaShop **1.7.8.11** / PHP **7.4**;
- PrestaShop **8.1.7** / PHP **8.1**;
- PrestaShop **8.2.7** / PHP **8.1**.

Cada job comprueba arranque real, instalación y activación del módulo `0.2.0`, tabla `pvf_order_sync`, hook `displayAdminOrderMainBottom`, clases runtime, generación de `OrderInvoice`, payload fiscal neutral y render del semáforo con estados verde, ámbar y rojo. Esta matriz no implica soporte para PrestaShop 9.

## Principio de seguridad

PrestaShop nunca recibe el certificado AEAT. El certificado y la clave privada permanecen únicamente en el runtime seguro de Puente VeriFactu.

El módulo tampoco decide `invoiceType`, `taxCode`, `regimeKey`, `operationClass`, datos del emisor ni criterios de conversión fiscal. Todo ello pertenece al `MappingProfile` y a la configuración server-side.

La tarjeta de estado es además **local-only**: al abrir la ficha de un pedido consulta exclusivamente `pvf_order_sync`. No ejecuta peticiones remotas a Puente VeriFactu ni a AEAT. La reconciliación sigue siendo una acción explícita del usuario.

## Semáforo en la ficha del pedido

La versión `0.2.0` usa el hook nativo `displayAdminOrderMainBottom`, presente en las tres versiones cubiertas por la matriz. La tarjeta muestra:

- estado operativo agregado;
- `recordId` cuando existe;
- fecha de la última actualización local;
- último error seguro cuando requiere revisión;
- enlace a los controles manuales del módulo con el pedido ya seleccionado.

Contrato visual:

- **verde — Synced:** `accepted`;
- **rojo — Action required:** `blocked`, `rejected`, `aeat_rejected`, `failed`;
- **ámbar — Pending / review:** estados intermedios o desconocidos, y cualquier estado no rojo con error local;
- **gris — Not sent:** todavía no existe una operación local.

Este semáforo es operativo, no una decisión fiscal. Solo resume el estado almacenado por el bridge.

## Fuente fiscal de la factura

El extractor **no reconstruye los impuestos leyendo directamente `order_detail`**. Usa las APIs nativas que PrestaShop emplea para su propia factura:

- `OrderInvoice::getProductTaxesBreakdown()` para productos y reparto de descuentos;
- `OrderInvoice::getShippingTaxesBreakdown()` para portes, incluido el caso de envío gratuito;
- `OrderInvoice::getWrappingTaxesBreakdown()` para embalaje/regalo;
- totales de la propia `OrderInvoice` para reconciliar base imponible y cuota.

Esto permite respetar el reparto que ya ha calculado PrestaShop y evita duplicar su motor de descuentos/redondeo dentro del conector. El resultado se agrupa por tipo y se reconcilia al céntimo con `total_paid_tax_excl` y `total_paid_tax_incl` antes de permitir el preflight.

Si PrestaShop no devuelve una fila para una base realmente al 0 %, el reconciliador puede completar únicamente ese residual sin cuota como línea `rate=0`. Si la cuota total difiere en más de un céntimo o la base extraída excede la factura, el conector bloquea la operación en lugar de inventar datos.

La ecotasa queda bloqueada hasta definir un contrato fiscal explícito para ella. También se bloquean pedidos con múltiples facturas: el flujo actual por ID de pedido solo fiscaliza cuando existe una única `OrderInvoice`, evitando seleccionar silenciosamente la factura equivocada.

## Requisitos

- PrestaShop >= 1.7.8 y < 9.0 para esta matriz contractual.
- PHP 7.4+; la matriz real valida las combinaciones indicadas arriba.
- extensiones PHP OpenSSL y cURL.
- endpoint Puente VeriFactu accesible mediante HTTPS.
- token Bearer y `MappingProfile` configurados en el servidor.
- una única factura fiscal de PrestaShop para el pedido en el flujo manual actual.

## Instalación de desarrollo

Copia `connectors/prestashop` como módulo `puenteverifactu` dentro de `modules/puenteverifactu/` y actívalo desde el gestor de módulos.

En **Configurar** introduce:

1. endpoint HTTPS del bridge;
2. ID del `MappingProfile`;
3. token Bearer;
4. timeout.

El token no vuelve a mostrarse después de guardarlo.

## Paquete reproducible

El artefacto de distribución se construye con:

```bash
npm run prestashop:package
```

El gate de reproducibilidad se ejecuta con:

```bash
npm run prestashop:package:check
```

El empaquetador genera una raíz única `puenteverifactu/`, incluye solo runtime/README/migraciones, excluye fixtures y tooling de desarrollo, fija orden/timestamps/permisos, calcula SHA-256 y mantiene entradas explícitas de directorio para compatibilidad con instaladores PrestaShop legacy. CI construye el ZIP dos veces y exige igualdad byte-a-byte.

## Upgrade validado

`scripts/ci/prestashop-upgrade-smoke.sh` valida en PrestaShop 8.2.7 el salto real **`0.1.0 → 0.2.0`**:

1. instala una baseline `0.1.0`;
2. establece explícitamente el estado previo sin `displayAdminOrderMainBottom`;
3. inserta una fila centinela en `pvf_order_sync`;
4. despliega el ZIP objetivo `0.2.0`;
5. ejecuta `prestashop:module upgrade puenteverifactu`;
6. exige que el hook nuevo quede registrado;
7. confirma que `record_id`, `idempotency_key` y estado local permanecen intactos.

## Flujo manual

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

`npm run prestashop:fixtures` cubre IVA simple y múltiple, portes/wrapping, descuentos globales ya distribuidos por PrestaShop, envío gratuito, bases al 0 % y reconciliación de diferencias de un céntimo. Los fixtures están en `fixtures/tax-breakdown-v1.json` y forman parte del CI obligatorio.

## Gate de instalación real

`scripts/ci/prestashop-compatibility-smoke.sh` usa PrestaShop Flashlight y MariaDB en contenedores efímeros. El smoke:

1. construye el ZIP reproducible `0.2.0`;
2. arranca una tienda PrestaShop real;
3. auto-instala exactamente ese ZIP;
4. valida versión, activación y hook nativo;
5. comprueba `pvf_order_sync`;
6. crea una factura nativa cuando el dataset no trae una;
7. construye el payload real;
8. inserta estados locales y exige que la ficha renderice verde, rojo y ámbar correctamente.

Se ejecuta en 1.7.8.11/PHP 7.4, 8.1.7/PHP 8.1 y 8.2.7/PHP 8.1. Por tanto, compatibilidad funcional y UX se prueban contra el mismo artefacto que se distribuiría.

## Límites conocidos

- no se fiscalizan automáticamente cambios de estado;
- no se procesan todavía abonos/rectificativas;
- pedidos con varias facturas quedan bloqueados hasta añadir selección explícita por `OrderInvoice`;
- ecotasa queda bloqueada hasta disponer de mapping fiscal específico;
- PrestaShop 9 no está declarado compatible y se evaluará explícitamente antes de incorporarlo.

## Siguiente incremento

1. rectificativas/abonos idempotentes con perfil fiscal separado;
2. automatización opt-in después de validar el flujo manual y rectificativo;
3. aceptación transversal de reconciliación/fallback común entre conectores.
