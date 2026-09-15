# Puente VeriFactu for WooCommerce

Conector nativo ligero entre WooCommerce y Puente VeriFactu.

## Principio

WooCommerce **no implementa lógica AEAT**. El plugin:

1. lee el pedido mediante WooCommerce CRUD;
2. construye un payload neutral;
3. ejecuta preflight en Puente VeriFactu;
4. envía con idempotencia;
5. guarda `recordId` y estado normalizado en el pedido;
6. reconcilia el estado posteriormente.

XML AEAT, certificados, hash, cadena, `invoiceType`, régimen y clasificación fiscal permanecen en el Puente.

## Compatibilidad

- WordPress 6.5+;
- PHP 7.4+;
- WooCommerce 8.2+;
- validado inicialmente contra WooCommerce 11.1;
- HPOS declarado compatible;
- no usa `get_post_meta`, `update_post_meta` ni acceso directo a tablas de pedidos.

WooCommerce 11.1 es la versión estable de referencia usada al iniciar este conector en septiembre de 2026. La compatibilidad debe volver a verificarse antes de cada release.

## Configuración

En `WooCommerce → Puente VeriFactu`:

- URL HTTPS del Puente;
- `MappingProfile` server-side;
- token Bearer del conector;
- estados Woo que disparan envío automático;
- meta-key opcional donde otro plugin guarda NIF/CIF del cliente;
- timeout HTTP.

El token se almacena cifrado usando las salts de WordPress. Nunca se incluye en logs, notas de pedido o payloads.

## Modo manual primero

Si no se marca ningún estado automático, el plugin queda en modo manual. Desde las acciones del pedido se puede:

- validar sin enviar;
- enviar;
- refrescar estado cuando ya existe `recordId`.

Esto permite probar mapping y datos antes de automatizar.

## Flujo automático

```text
Woo status change
      |
      v
Action Scheduler
      |
      v
build neutral source payload
      |
      v
POST /v1/preflight
      |
      +-- invalid --> blocked; no fiscalization
      |
      v
POST /v1/fiscal-records + Idempotency-Key
      |
      v
store recordId/status on WC_Order metadata
      |
      v
GET /v1/fiscal-records/{recordId} for reconciliation
```

Action Scheduler se usa cuando está inicializado. Existe fallback a un evento único de WP-Cron para no ejecutar HTTP dentro del cambio de estado del pedido.

## Idempotencia

La clave v1 es estable por sitio + pedido:

```text
woo:{blogId}:order:{orderId}:issue:v1
```

Si Woo dispara varias veces el mismo evento, Puente devuelve el mismo recurso. Si el contenido del pedido cambia después de fiscalizarse, el conector **no crea otra factura silenciosamente**: al existir `recordId`, solo reconcilia. Las rectificaciones/reembolsos se implementarán como operaciones explícitas separadas.

## Payload neutral

Campos principales:

- `source_invoice_id`;
- `order_id` / `order_number`;
- `order_date`;
- `description`;
- `currency`;
- `customer_name`;
- `customer_tax_id` opcional;
- `total_amount`;
- `discount_amount`;
- `shipping_amount`;
- `tax_amount`;
- `tax_lines[]`.

`tax_lines[]` puede contener varias líneas con `rate`, `baseAmount` y `taxAmount`. El origen **no puede introducir** `taxCode`, `regimeKey` u `operationClass`: esos campos se añaden server-side mediante `taxLineDefaults` del `MappingProfile`.

## MappingProfile

Ver `examples/mapping-profile.json`.

Es solo un ejemplo estructural. Antes de activarlo se deben configurar en servidor los datos fiscales reales de la organización y validar por preflight. No copiar identificadores de ejemplo a producción.

## Reintentos

Los fallos marcados `retryable` se reintentan hasta cinco intentos con backoff. Los errores de validación/preflight quedan bloqueados para intervención humana y no se reenvían automáticamente.

## Datos guardados en el pedido

Se usa exclusivamente CRUD de WooCommerce:

- `_pv_record_id`;
- `_pv_status`;
- `_pv_last_error`;
- `_pv_last_synced_at`;
- `_pv_payload_sha256`.

No se guarda certificado AEAT ni secreto del Puente en metadata del pedido.

## Fallback

Si el plugin deja de ser compatible temporalmente con una actualización de WooCommerce, el negocio puede seguir usando CSV/XLSX a través del wizard universal. El conector nativo es una optimización, no una dependencia del motor fiscal.

## Fuera de este primer bloque

- rectificaciones/reembolsos explícitos;
- panel visual de tráfico verde/ámbar/rojo en listado de pedidos;
- mapping de moneda dinámica para escenarios multi-divisa;
- paquete ZIP/release WordPress;
- matriz automatizada de compatibilidad WordPress/WooCommerce.
