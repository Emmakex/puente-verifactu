# Puente VeriFactu for WooCommerce

Conector nativo ligero entre WooCommerce y Puente VeriFactu.

## Principio

WooCommerce **no implementa lógica AEAT**. El plugin:

1. lee pedidos y reembolsos mediante WooCommerce CRUD;
2. construye payloads neutrales;
3. ejecuta preflight en Puente VeriFactu;
4. envía con idempotencia;
5. guarda `recordId` y estado normalizado en el objeto Woo correspondiente;
6. reconcilia el estado posteriormente;
7. muestra un semáforo operativo en el listado de pedidos.

XML AEAT, certificados, hash, cadena, `invoiceType`, `R1–R5`, `S/I`, régimen y clasificación fiscal permanecen en el Puente.

## Compatibilidad

- WordPress 6.5+;
- PHP 7.4+;
- WooCommerce 8.2+;
- validado inicialmente contra WooCommerce 11.1;
- HPOS declarado compatible;
- columnas de estado compatibles con HPOS y tabla legacy;
- no usa `get_post_meta`, `update_post_meta` ni acceso directo a tablas de pedidos.

WooCommerce recomienda CRUD para mantener compatibilidad con HPOS; el conector sigue esa regla en pedidos y `WC_Order_Refund`.

La matriz CI completa y las versiones vigentes se documentan en `docs/woocommerce-compatibility.md`. El gate instala el ZIP real sobre WordPress + WooCommerce, activa HPOS y ejecuta un smoke de pedido CRUD.

## Configuración

En `WooCommerce → Puente VeriFactu`:

- URL HTTPS del Puente;
- `MappingProfile` server-side para facturas ordinarias;
- `MappingProfile` server-side independiente para rectificativas de refunds;
- token Bearer del conector;
- fuente explícita del número de factura original;
- meta-key explícita del número fiscal de la rectificativa/refund;
- estados Woo que disparan envío automático;
- activación separada de refunds automáticos;
- meta-key opcional donde otro plugin guarda NIF/CIF del cliente;
- timeout HTTP.

El token se almacena cifrado usando las salts de WordPress. Nunca se incluye en logs, notas de pedido o payloads.

La conversión fiscal de divisas se configura exclusivamente en el servidor Puente. El plugin no recibe ni almacena tipos de cambio.

## Número de factura ordinaria

WooCommerce core crea pedidos, no una numeración fiscal que Puente pueda asumir automáticamente. Por eso el plugin obliga a elegir una fuente:

- **meta-key de un plugin de facturación existente** — recomendada cuando la tienda ya genera facturas;
- **número de pedido** — solo si el comercio confirma explícitamente que también es su número fiscal;
- **sin configurar** — `invoice_number` queda vacío y preflight bloquea cualquier emisión.

También existe el filtro `pv_woo_invoice_number`. El perfil de referencia mapea `invoice_number → number`; nunca usa `order_number` silenciosamente.

La fecha de factura se obtiene inicialmente de la fecha de creación del pedido y puede adaptarse con `pv_woo_invoice_date` cuando el sistema de facturación existente tenga otra fecha real de expedición.

## Reembolsos y facturas rectificativas

WooCommerce expone un refund como `WC_Order_Refund`, pero **un refund no determina por sí mismo la clasificación fiscal de la factura rectificativa**.

Por eso:

- `woocommerce_order_refunded` solo dispara una operación neutral;
- cada refund tiene su propia idempotencia `woo:{blogId}:refund:{refundId}:issue:v1`;
- la factura original debe tener `recordId` antes de procesar su refund;
- la rectificativa necesita su propio número fiscal mediante `refund_invoice_number_meta_key` o filtro `pv_woo_refund_invoice_number`;
- la fecha puede adaptarse con `pv_woo_refund_invoice_date`;
- los importes y signos reales del refund se preservan;
- el `refund_profile_id` server-side decide `R1–R5`, `S/I`, emisor, régimen y clasificación fiscal;
- si preflight falla, el refund queda `blocked` y no se fiscaliza;
- `auto_refunds` está desactivado por defecto.

La AEAT distingue rectificativas `R1–R5` y modalidades por sustitución/diferencias, por lo que el plugin no transforma automáticamente “refund” en una categoría fiscal concreta.

Ver `examples/refund-mapping-profile.json`. Sus valores `CONFIGURE_*` son intencionadamente inválidos hasta que el perfil se configure correctamente en servidor.

## Flujo de factura ordinaria

```text
Woo status change
      |
      v
Action Scheduler
      |
      v
neutral order payload
      |
      v
POST /v1/preflight
      |
      +-- invalid --> blocked
      |
      v
POST /v1/fiscal-records + Idempotency-Key
      |
      v
store recordId/status on WC_Order
      |
      v
GET /v1/fiscal-records/{recordId}
```

## Flujo de refund

```text
woocommerce_order_refunded
      |
      v
Action Scheduler
      |
      v
WC_Order_Refund + parent WC_Order
      |
      +-- original without recordId --> blocked
      |
      v
neutral refund payload
      |
      v
refund MappingProfile server-side
      |
      v
preflight -> issue -> reconcile
      |
      v
store status on WC_Order_Refund
```

Action Scheduler se usa cuando está inicializado; existe fallback a WP-Cron para no ejecutar HTTP dentro del evento síncrono de WooCommerce.

## Semáforo operativo

El listado de pedidos añade una columna `VeriFactu` tanto en HPOS como en la tabla legacy:

- **verde — Synced:** operación aceptada y sin error de sincronización pendiente;
- **ámbar — Pending / review:** preflight válido, fiscalizado, en cola, enviando, reintento, aceptado con avisos, refund pendiente o último intento de reconciliación fallido;
- **rojo — Action required:** bloqueado, rechazado o fallo final;
- **gris — Not sent:** aún no existe operación.

El estado agregado considera la factura principal y sus refunds. Un refund bloqueado vuelve rojo el pedido aunque la factura original esté aceptada. Un `_pv_last_error` degrada un verde a ámbar hasta que una reconciliación posterior tenga éxito y limpie el error.

El semáforo es operativo; nunca convierte un rechazo en aceptación ni sustituye el estado detallado de Puente.

## Modo manual primero

Si no se seleccionan estados automáticos, la factura ordinaria queda en modo manual. Desde las acciones del pedido se puede:

- validar sin enviar;
- enviar;
- refrescar estado;
- procesar los refunds existentes.

Los refunds automáticos requieren activación independiente y configuración previa del perfil rectificativo y numeración fiscal.

## Payloads neutrales

Factura ordinaria:

- `source_invoice_id`;
- `order_id` / `order_number`;
- `invoice_number`;
- `order_date`;
- `description`;
- `currency`;
- `customer_name` / `customer_tax_id`;
- `total_amount`;
- `tax_lines[]`.

Refund:

- `source_invoice_id`;
- `refund_id` / `parent_order_id`;
- `refund_invoice_number`;
- `refund_date`;
- `original_invoice_number` / `original_invoice_date`;
- `currency`;
- destinatario;
- `total_amount`;
- `tax_lines[]`.

`tax_lines[]` puede contener varios tipos impositivos. El origen no puede introducir `taxCode`, `regimeKey`, `operationClass` ni `invoiceType`; estos datos permanecen server-side.

La moneda comercial viene del objeto Woo. Si no es EUR, Puente busca una conversión fiscal server-side por organización, instalación, moneda y fecha; conserva la vista comercial original y genera una vista fiscal EUR separada. Si falta el cambio o los céntimos no reconcilian, preflight bloquea sin emitir. El plugin nunca inventa ni aporta el tipo de cambio. Ver `docs/euro-conversion-v1.md`.

## Reintentos

Los fallos técnicos marcados `retryable` se reintentan hasta cinco intentos con backoff. Los errores de validación/preflight quedan bloqueados para intervención humana. Al agotar reintentos, el estado pasa a `blocked`.

## Metadata WooCommerce

En pedido y refund se usa exclusivamente CRUD:

- `_pv_record_id`;
- `_pv_status`;
- `_pv_last_error`;
- `_pv_last_synced_at`;
- `_pv_payload_sha256`.

No se guarda certificado AEAT ni secreto del Puente en metadata WooCommerce.

## ZIP reproducible

El artefacto instalable se construye desde una allowlist de runtime:

```bash
npm run woo:package
```

El ZIP queda en `dist/puente-verifactu-woocommerce-0.2.0.zip`. `npm run woo:package:check` lo construye dos veces y exige identidad byte a byte, estructura segura y exclusión de perfiles server-side, scripts y secretos.

El CI instala ese ZIP real en la matriz WordPress/WooCommerce antes de considerar compatible el conector.

## Fallback

Si una actualización de WooCommerce rompe temporalmente el conector, el negocio puede seguir usando CSV/XLSX mediante el wizard universal. El conector nativo es una optimización, no una dependencia del motor fiscal.

## Estado dentro de Fase 5

El bloque WooCommerce queda técnicamente cerrado: facturas ordinarias, rectificativas por refund, semáforo operativo, compatibilidad empaquetada y conversión fiscal EUR server-side están cubiertos. El siguiente conector nativo es PrestaShop.
