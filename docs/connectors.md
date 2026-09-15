# Conectores y adaptadores

## Objetivo

Permitir que cualquier sistema use el núcleo sin copiar lógica fiscal y sin obligar al cliente a sustituir su herramienta actual.

## Canales soportados como arquitectura

1. manual asistido;
2. CSV/Excel mediante mapping reutilizable;
3. webhook/HTTP low-code;
4. REST/SDK genérico;
5. plugin/módulo/conector nativo.

## Contrato obligatorio

Un conector/adaptador debe:

1. identificar una operación de origen de forma estable;
2. mapear datos al contrato canónico o producir un candidato de preflight;
3. usar idempotencia;
4. persistir la relación origen ↔ registro cuando aplique;
5. exponer estado comprensible;
6. permitir reconciliación segura;
7. declarar versión y capacidades;
8. ofrecer estrategia de fallback cuando sea razonable.

Connector Contract Suite v2 añade una semántica común de sincronización: cuando ya existe `recordId`, el conector **solo reconcilia** y nunca crea otra operación como fallback; los fallos retryable deben preservar `recordId`/idempotencia, y las operaciones nuevas mantienen preflight previo + clave idempotente estable en cada reintento.

## Prohibiciones

- Construir XML AEAT por su cuenta.
- Elegir endpoints AEAT arbitrariamente.
- Acceder a certificados de otra organización.
- Conceder roles/permisos desde cliente.
- Convertir rechazo en aceptación.
- Crear otro registro cuando lo correcto es reconciliar/reintentar el existente.
- Modificar un mapping activo silenciosamente.

## Prioridad de adaptadores

1. `reference`: especificación ejecutable del contrato.
2. `file-import`: CSV/XLSX y fallback universal.
3. WordPress + WooCommerce — primera implementación nativa de Fase 5, técnicamente cerrada.
4. PrestaShop — segunda implementación nativa, alcance `0.4.0` técnicamente cerrado.
5. REST/webhook universal.
6. ERP/CRM prioritarios según demanda real.

## Conectores nativos

Son capas cliente ligeras. Deben capturar el evento correcto del sistema origen, mapear datos y mostrar estado. La lógica fiscal, credenciales AEAT y transporte oficial permanecen en el puente.

### WooCommerce v0.2

El conector nativo sigue estas reglas adicionales:

- HPOS declarado compatible y acceso a pedidos/refunds exclusivamente mediante WooCommerce CRUD;
- operación HTTP fuera del cambio síncrono de estado mediante Action Scheduler, con fallback de evento único WP-Cron;
- preflight antes de emitir;
- claves idempotentes estables por sitio + pedido/refund;
- `recordId` persistido en metadata del objeto Woo correspondiente y posteriores eventos convertidos en reconciliación, nunca en nuevas emisiones silenciosas;
- helpers compartidos entre pedidos y refunds basados en `WC_Abstract_Order`, compatible con las implementaciones HPOS de `WC_Order_Refund`;
- token del Puente cifrado en WordPress y nunca guardado en metadata/logs;
- payload minimizado y neutral;
- NIF/CIF configurable mediante la meta-key que el comercio ya utilice, sin acoplarse a un plugin de terceros;
- múltiples tipos de IVA representados como `tax_lines[]` de origen;
- `taxCode`, `regimeKey`, `operationClass`, `invoiceType`, `R1–R5` y `S/I` exclusivamente server-side;
- moneda tomada del pedido; cualquier conversión fiscal a EUR pertenece al motor server-side;
- refunds tratados como rectificativas independientes, con numeración y `MappingProfile` separados;
- fallback CSV/XLSX documentado para mantener operatividad si una actualización de WooCommerce rompe temporalmente el conector.

El gate real instala el ZIP reproducible en:

- WordPress 6.5 / WooCommerce 8.2.0 / PHP 7.4;
- WordPress 7.0.4 / WooCommerce 11.0.1 / PHP 8.2;
- WordPress 7.1 / WooCommerce 11.1.0 / PHP 8.3.

Además de HPOS/CRUD y payload, cada combinación ejecuta los seis escenarios nativos de Connector Contract Suite v2 para factura y refund.

### PrestaShop 0.4.0

El segundo conector nativo soporta modo manual seguro y automatización **opt-in** por tienda:

- alcance declarado PrestaShop 1.7.8.x y 8.x;
- configuración aislada por tienda de endpoint HTTPS, `MappingProfile`, timeout y token Bearer cifrado con AES-256-GCM;
- factura seleccionada desde `OrderInvoice`; pedidos con varias facturas quedan bloqueados hasta disponer de selección explícita;
- número fiscal obtenido de la factura nativa;
- desglose tributario obtenido de las APIs nativas de `OrderInvoice` para productos, portes y wrapping;
- reconciliación exacta de base/cuota antes del preflight;
- ecotasa bloqueada hasta mapping explícito;
- payload neutral con moneda de origen y conversión fiscal no-EUR resuelta server-side;
- flujo manual `preflight -> issue -> reconcile` siempre disponible;
- automatización por `actionOrderStatusPostUpdate` y `actionOrderSlipAdd`, ambos switches OFF por defecto;
- `OrderSlip` tratado como rectificativa independiente con perfil separado, factura original obligatoria e idempotencia propia;
- `recordId` existente obliga a reconciliar y nunca a reemitir;
- `PVFPrestaShopApiException` conserva código, HTTP status, correlation ID y `retryable`; errores recuperables dejan estado `retry_pending` preservando identidad local;
- estado principal y rectificativo visibles en la ficha nativa del pedido;
- upgrade `0.3.0 → 0.4.0` preserva estado y mantiene automatización desactivada.

La matriz real instala el ZIP reproducible y ejecuta factura, `OrderSlip` y los seis escenarios de Connector Contract Suite v2 en:

- PrestaShop 1.7.8.11 / PHP 7.4;
- PrestaShop 8.1.7 / PHP 8.1;
- PrestaShop 8.2.7 / PHP 8.1.

El certificado AEAT no entra nunca en PrestaShop. El módulo no construye XML ni decide clasificación fiscal sensible.

## Suite contractual

Todos los canales deben pasar los escenarios relevantes de alta, duplicado, corrección, rechazo, timeout, reintento, caída, datos incompletos, decimales, recuperación y cambio de mapping.

Para extensiones nativas, `npm run native:contract:v2` impone un fixture compartido de seis escenarios:

- factura con `recordId` + fallo retryable → preservar y reconciliar, sin reemisión;
- factura con `recordId` + fallo no retryable → bloquear/preservar, sin reemisión;
- factura nueva + fallo retryable → mantener la misma idempotencia;
- rectificativa con `recordId` + fallo retryable → preservar y reconciliar, sin reemisión;
- rectificativa con `recordId` + fallo no retryable → bloquear/preservar, sin reemisión;
- rectificativa nueva + fallo retryable → mantener la misma idempotencia.

WooCommerce y PrestaShop ejecutan esos escenarios dentro de sus instalaciones reales de matriz, no únicamente mediante inspección estática. Con ello la **aceptación transversal de Fase 5 queda cerrada**.

El gate externo AEAT #6 continúa siendo requisito obligatorio antes de cualquier piloto fiscal real o release.
