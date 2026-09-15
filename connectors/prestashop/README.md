# Puente VeriFactu — PrestaShop connector 0.4.0

Conector nativo y deliberadamente fino para **PrestaShop 1.7.8.x y 8.x**. Extrae hechos comerciales de facturas y abonos nativos, construye payloads neutrales y habla con la API universal de Puente VeriFactu. **No contiene reglas AEAT, XML, SOAP, certificados ni decisiones fiscales sensibles.**

## Estado

Versión `0.4.0` con flujo manual seguro, automatización **opt-in** por tienda y aceptación transversal Connector Contract Suite v2 cerrada:

- configuración por tienda para endpoint HTTPS y `MappingProfile` server-side;
- Bearer token cifrado localmente con AES-256-GCM usando una clave derivada de `_COOKIE_KEY_`;
- payload neutral de factura con número fiscal nativo, fecha, moneda, destinatario, totales y desglose por tipos;
- flujo manual de factura `preflight -> issue -> reconcile` siempre disponible;
- idempotencia estable por tienda + pedido + número de factura;
- semáforo verde/ámbar/rojo/gris en la ficha nativa del pedido;
- rectificativas basadas en `OrderSlip`, con perfil fiscal server-side separado;
- relación explícita entre cada rectificativa y la factura original;
- idempotencia independiente por tienda + abono + número rectificativo;
- persistencia separada `pvf_order_slip_sync` para múltiples abonos del mismo pedido;
- extracción del tipo histórico mediante `OrderDetail::getTaxCalculator()->getTotalRate()` y bloqueo si la cuota observada no reconcilia;
- líneas y totales rectificativos con signo negativo;
- automatización independiente para facturas y abonos, **desactivada por defecto**;
- reconciliación en lugar de reemisión cuando ya existe `recordId`;
- excepción API tipada que conserva código, HTTP status, correlation ID y `retryable`;
- errores recuperables persistidos como `retry_pending` sin perder `recordId` ni idempotencia;
- gate determinista con IVA 21 %, 10 % y 4 %, redondeo y rechazo de incoherencias;
- smoke real en PrestaShop 1.7.8.11, 8.1.7 y 8.2.7;
- seis escenarios nativos Contract Suite v2 ejecutados en cada versión real para factura y rectificativa;
- ZIP reproducible con allowlist de runtime, SHA-256 y layout compatible con instaladores legacy;
- upgrade real `0.3.0 → 0.4.0` que preserva estado existente, registra los hooks automáticos y mantiene ambos switches en OFF.

La automatización no sustituye el modo manual: simplemente reutiliza los mismos invariantes de preflight, idempotencia y estado local cuando el comercio decide activarla.

## Compatibilidad validada

La matriz de CI instala el **ZIP reproducible de distribución** dentro de tiendas efímeras PrestaShop Flashlight. Combinaciones validadas:

- PrestaShop **1.7.8.11** / PHP **7.4**;
- PrestaShop **8.1.7** / PHP **8.1**;
- PrestaShop **8.2.7** / PHP **8.1**.

Cada job comprueba arranque real, instalación y activación del módulo `0.4.0`, tablas de sincronización, hooks nativos, factura, payload principal, semáforo operativo y creación de un `OrderSlip` real. También demuestra que los hooks automáticos registrados **no crean estado ni intentan procesar operaciones mientras sus switches permanecen desactivados** y ejecuta los seis escenarios transversales de reconciliación/idempotencia de Connector Contract Suite v2. Esta matriz no implica soporte para PrestaShop 9.

Los datasets Flashlight usados por la prueba runtime tienen una línea al 0 %. Para que esa limitación no deje sin probar IVA positivo, CI ejecuta además `npm run prestashop:rectification-fixtures`, que usa la misma validación del runtime con 21 %, 10 %, 4 %, redondeos admisibles y desajustes que deben bloquearse.

## Principio de seguridad

PrestaShop nunca recibe el certificado AEAT. El certificado y la clave privada permanecen únicamente en el runtime seguro de Puente VeriFactu.

El módulo tampoco decide `invoiceType`, `R1–R5`, tipo de rectificación `S/I`, `taxCode`, `regimeKey`, `operationClass`, datos del emisor ni criterios de conversión fiscal. Todo ello pertenece al `MappingProfile` y a la configuración server-side.

Las tarjetas de estado son **local-only**: al abrir la ficha de un pedido consultan exclusivamente `pvf_order_sync` y `pvf_order_slip_sync`. No ejecutan peticiones remotas a Puente VeriFactu ni a AEAT.

## Factura original

El extractor usa las APIs nativas que PrestaShop emplea para su propia `OrderInvoice`:

- `OrderInvoice::getProductTaxesBreakdown()` para productos y reparto de descuentos;
- `OrderInvoice::getShippingTaxesBreakdown()` para portes;
- `OrderInvoice::getWrappingTaxesBreakdown()` para wrapping;
- totales de la propia `OrderInvoice` para reconciliar base imponible y cuota.

El resultado se agrupa por tipo y se reconcilia al céntimo antes del preflight. El conector bloquea ecotasa sin mapping explícito, incoherencias materiales y pedidos con múltiples facturas, en vez de seleccionar o inventar datos silenciosamente.

## Abonos / rectificativas

PrestaShop representa los abonos mediante `OrderSlip`. Cada `OrderSlip` se trata como una operación rectificativa independiente.

El payload incluye identidad estable, número y fecha nativos del abono, destinatario y moneda del pedido original, referencia a la factura original, totales negativos y desglose por el tipo histórico de cada `OrderDetail`.

El conector **no infiere el IVA dividiendo cuota/base**. Recupera el `TaxCalculator` histórico de la línea original y compara la cuota observada con ese tipo. Se toleran únicamente pequeñas diferencias de redondeo; una discrepancia material bloquea la operación.

Antes de procesar un abono se exige que la factura original tenga `recordId` local. Esto evita una rectificativa huérfana respecto al flujo del bridge.

### MappingProfile rectificativo

El ejemplo está en `examples/refund-mapping-profile.json`. Ese perfil deja explícitamente `R1–R5` y `S/I` como decisiones **server-side**. PrestaShop aporta el hecho comercial del abono, nunca la clasificación fiscal sensible.

### Flujo manual rectificativo

Para un `OrderSlip`:

1. **Corrective preflight**: valida sin crear registro fiscal.
2. **Create corrective record**: repite preflight y crea el registro solo si pasa.
3. **Refresh corrective status**: reconcilia un `recordId` ya existente.

La clave de idempotencia es estable por tienda + `OrderSlip` + número rectificativo. Si ya existe `recordId`, el flujo reconcilia en lugar de crear otra operación.

## Automatización opt-in

La versión `0.4.0` registra dos eventos nativos, pero **registrar el hook no equivale a activar la automatización**:

- `actionOrderStatusPostUpdate` para facturas;
- `actionOrderSlipAdd` para abonos.

En **Configurar** existen dos switches independientes por tienda:

- **Automatic invoices**;
- **Automatic corrective credit slips**.

Ambos se instalan y se migran con valor `OFF`. Una actualización desde 0.3.0 no comienza a procesar operaciones por sí sola.

### Facturas automáticas

Cuando el switch de facturas está activo, un evento posterior al cambio de estado:

1. carga el pedido de la tienda correcta;
2. exige exactamente una `OrderInvoice`;
3. si ya existe `recordId`, reconcilia su estado;
4. si no existe, construye el mismo payload neutral del modo manual;
5. ejecuta preflight;
6. solo si el preflight pasa, crea el registro usando la misma clave de idempotencia estable.

Pedidos sin factura o con varias facturas no se emiten automáticamente.

### Rectificativas automáticas

Cuando el switch de rectificativas está activo, la creación de un `OrderSlip`:

1. identifica el abono nativo;
2. exige que la factura original ya tenga `recordId`;
3. exige el `MappingProfile` rectificativo separado;
4. si el abono ya tiene `recordId`, reconcilia;
5. en caso contrario ejecuta preflight y, si pasa, crea la operación con la idempotencia del `OrderSlip`.

Si el bridge no está disponible, `PVFPrestaShopApiException` conserva si el fallo es recuperable. Un error retryable deja `retry_pending`; uno no recuperable deja `blocked`. En ambos casos se conserva cualquier `recordId`/idempotencia existente y nunca se transforma un fallo de reconciliación en una nueva emisión.

## Connector Contract Suite v2

Factura y rectificativa comparten la misma semántica transversal:

- `recordId` existente + fallo retryable → preservar identidad, dejar estado recuperable y no reemitir;
- `recordId` existente + fallo no retryable → preservar identidad, bloquear/revisar y no reemitir;
- operación nueva + fallo retryable → conservar exactamente la misma clave idempotente en el siguiente intento.

Esos seis escenarios se ejecutan dentro de las tres instalaciones reales de la matriz, junto con factura nativa y `OrderSlip` real. El meta-gate `npm run native:contract:v2` obliga además a que WooCommerce y PrestaShop mantengan el mismo fixture contractual.

## Persistencia local

Factura principal:

- tabla `pvf_order_sync`;
- única por `id_shop + id_order`.

Rectificativas:

- tabla `pvf_order_slip_sync`;
- única por `id_shop + id_order_slip`;
- permite múltiples abonos independientes asociados al mismo pedido.

Ambas tablas guardan solo estado mínimo operativo: `record_id`, idempotencia, estado, último error y fecha de actualización. No almacenan certificados ni lógica fiscal AEAT.

## Semáforo en la ficha del pedido

La tarjeta usa `displayAdminOrderMainBottom` y resume tanto la factura principal como sus rectificativas.

Contrato visual:

- **verde — Synced:** `accepted`;
- **rojo — Action required:** `blocked`, `rejected`, `aeat_rejected`, `failed`;
- **ámbar — Pending / review:** `retry_pending`, otros estados intermedios/desconocidos o estados con error local;
- **gris — Not sent:** no existe todavía operación local.

El semáforo es únicamente operativo; no decide tratamiento fiscal.

## Requisitos

- PrestaShop >= 1.7.8 y < 9.0 para esta matriz contractual.
- PHP 7.4+; la matriz real valida las combinaciones indicadas arriba.
- extensiones PHP OpenSSL y cURL.
- endpoint Puente VeriFactu mediante HTTPS.
- token Bearer.
- `MappingProfile` de factura configurado server-side.
- `MappingProfile` rectificativo separado para procesar abonos.
- una única `OrderInvoice` fiscal por pedido para el flujo automático actual.

## Instalación de desarrollo

Copia `connectors/prestashop` como módulo `puenteverifactu` dentro de `modules/puenteverifactu/` y actívalo desde el gestor de módulos.

En **Configurar** introduce endpoint HTTPS, MappingProfile de factura, MappingProfile rectificativo, token Bearer y timeout. Los switches automáticos permanecen desactivados hasta que el comercio decida activarlos. El token no vuelve a mostrarse después de guardarlo.

## Paquete reproducible

```bash
npm run prestashop:package
npm run prestashop:package:check
```

El ZIP contiene exclusivamente runtime, README y migraciones. Excluye ejemplos, fixtures y tooling. CI lo construye dos veces y exige igualdad byte-a-byte antes de usarlo en instalaciones reales. `PVFPrestaShopApiException.php` forma parte obligatoria del runtime empaquetado.

## Upgrade validado

`scripts/ci/prestashop-upgrade-smoke.sh` valida en PrestaShop 8.2.7 el salto **`0.3.0 → 0.4.0`**:

1. instala una baseline 0.3.0 sin hooks automáticos;
2. conserva una factura principal ya sincronizada;
3. conserva una rectificativa ya sincronizada;
4. despliega el ZIP 0.4.0;
5. ejecuta `prestashop:module upgrade puenteverifactu`;
6. exige registro de ambos hooks automáticos;
7. confirma que factura y rectificativa conservan `recordId`, idempotencia y estado;
8. exige que ambos switches automáticos continúen en `OFF`.

## Gates CI

- `npm run prestashop:contract`: arquitectura, seguridad, opt-in e invariantes del conector.
- `npm run prestashop:fixtures`: desglose/reconciliación de factura principal.
- `npm run prestashop:rectification-fixtures`: IVA positivo 21/10/4, tolerancia de redondeo y rechazo de incoherencias rectificativas.
- `npm run prestashop:package:check`: ZIP reproducible 0.4.0.
- `npm run native:contract:v2`: contrato transversal compartido con WooCommerce.
- `scripts/ci/prestashop-compatibility-smoke.sh`: instalación real, hooks, defaults OFF, factura, `OrderSlip` real y escenarios v2 en las tres versiones.
- `scripts/ci/prestashop-upgrade-smoke.sh`: migración 0.3.0 → 0.4.0 preservando estado y manteniendo la automatización desactivada.

## Límites conocidos

- la automatización actual se ejecuta desde los eventos nativos; una cola durable/reintento desacoplado específico del conector se evaluará como hardening de Fase 6 si hace falta;
- pedidos con varias facturas quedan fuera de la automatización hasta añadir selección explícita por `OrderInvoice`;
- ecotasa queda bloqueada hasta disponer de mapping fiscal específico;
- el smoke runtime de Flashlight usa datos al 0 %, complementados por fixtures deterministas de IVA positivo;
- PrestaShop 9 no está declarado compatible y se evaluará explícitamente antes de incorporarlo.

## Estado dentro de Fase 5

PrestaShop `0.4.0` queda técnicamente cerrado junto con WooCommerce: reconciliación/fallback, rectificativas, packaging, upgrade, automatización opt-in y Connector Contract Suite v2 están cubiertos en matrices reales. La aceptación transversal de Fase 5 está cerrada.

El gate externo AEAT #6 continúa bloqueando cualquier piloto fiscal real o release. El siguiente bloque del roadmap es Fase 6 — Production Readiness.
