# Puente VeriFactu — PrestaShop connector 0.3.0

Conector nativo y deliberadamente fino para **PrestaShop 1.7.8.x y 8.x**. Extrae hechos comerciales de facturas y abonos nativos, construye payloads neutrales y habla con la API universal de Puente VeriFactu. **No contiene reglas AEAT, XML, SOAP, certificados ni decisiones fiscales sensibles.**

## Estado

Versión `0.3.0` validada con flujo manual seguro para factura y rectificativa, extractor fiscal reforzado, paquete reproducible, estado operativo en la ficha del pedido y abonos nativos `OrderSlip`:

- configuración por tienda para endpoint HTTPS y `MappingProfile` server-side;
- Bearer token cifrado localmente con AES-256-GCM usando una clave derivada de `_COOKIE_KEY_`;
- payload neutral de factura con número fiscal nativo, fecha, moneda, destinatario, totales y desglose por tipos;
- flujo manual de factura `preflight -> issue -> reconcile`;
- idempotencia estable por tienda + pedido + número de factura;
- semáforo verde/ámbar/rojo/gris en la ficha nativa del pedido;
- rectificativas basadas en `OrderSlip`, con perfil fiscal server-side separado;
- relación explícita entre cada rectificativa y la factura original;
- idempotencia independiente por tienda + abono + número rectificativo;
- persistencia separada `pvf_order_slip_sync` para múltiples abonos del mismo pedido;
- extracción del tipo histórico mediante `OrderDetail::getTaxCalculator()->getTotalRate()` y bloqueo si la cuota observada no reconcilia;
- líneas y totales rectificativos con signo negativo;
- gate determinista adicional con IVA 21 %, 10 % y 4 %, redondeo y rechazo de incoherencias;
- smoke real que crea un `OrderSlip` nativo dentro de PrestaShop 1.7.8.11, 8.1.7 y 8.2.7;
- ZIP reproducible con allowlist de runtime, SHA-256 y layout compatible con instaladores legacy;
- upgrade real `0.2.0 → 0.3.0` preservando el estado de la factura original y creando el almacenamiento de rectificativas.

Todavía **no** activa envíos automáticos por eventos. El siguiente incremento funcional es la automatización opt-in, manteniendo siempre disponible el modo manual seguro.

## Compatibilidad validada

La matriz de CI instala el **ZIP reproducible de distribución** dentro de tiendas efímeras PrestaShop Flashlight. Las combinaciones validadas el **15 de septiembre de 2026** son:

- PrestaShop **1.7.8.11** / PHP **7.4**;
- PrestaShop **8.1.7** / PHP **8.1**;
- PrestaShop **8.2.7** / PHP **8.1**.

Cada job comprueba arranque real, instalación y activación del módulo `0.3.0`, tablas de sincronización, hook `displayAdminOrderMainBottom`, factura nativa, payload principal, semáforo operativo y creación de un `OrderSlip` real mediante `OrderSlip::create()`. Después construye el payload rectificativo, verifica la referencia a la factura original, signos, tipo histórico y estado local de la rectificativa. Esta matriz no implica soporte para PrestaShop 9.

Los datasets Flashlight usados por la prueba runtime tienen una línea al 0 %. Para que esa limitación del dataset no deje sin probar el cálculo con IVA positivo, CI ejecuta además `npm run prestashop:rectification-fixtures`, que usa la misma función de validación del runtime con 21 %, 10 %, 4 %, redondeos admisibles y desajustes que deben bloquearse.

## Principio de seguridad

PrestaShop nunca recibe el certificado AEAT. El certificado y la clave privada permanecen únicamente en el runtime seguro de Puente VeriFactu.

El módulo tampoco decide `invoiceType`, `R1–R5`, tipo de rectificación `S/I`, `taxCode`, `regimeKey`, `operationClass`, datos del emisor ni criterios de conversión fiscal. Todo ello pertenece al `MappingProfile` y a la configuración server-side.

Las tarjetas de estado son **local-only**: al abrir la ficha de un pedido consultan exclusivamente `pvf_order_sync` y `pvf_order_slip_sync`. No ejecutan peticiones remotas a Puente VeriFactu ni a AEAT. La reconciliación sigue siendo una acción explícita.

## Factura original

El extractor de factura usa las APIs nativas que PrestaShop emplea para su propia `OrderInvoice`:

- `OrderInvoice::getProductTaxesBreakdown()` para productos y reparto de descuentos;
- `OrderInvoice::getShippingTaxesBreakdown()` para portes;
- `OrderInvoice::getWrappingTaxesBreakdown()` para wrapping;
- totales de la propia `OrderInvoice` para reconciliar base imponible y cuota.

El resultado se agrupa por tipo y se reconcilia al céntimo antes del preflight. El conector bloquea ecotasa sin mapping explícito, incoherencias materiales y pedidos con múltiples facturas, en vez de seleccionar o inventar datos silenciosamente.

## Abonos / rectificativas

PrestaShop representa los abonos mediante `OrderSlip`. La versión `0.3.0` trata cada `OrderSlip` como una operación rectificativa independiente.

El payload incluye:

- identidad estable `prestashop:{shopId}:order-slip:{id}`;
- número de abono basado en `PS_CREDIT_SLIP_PREFIX` + ID nativo de seis dígitos;
- fecha nativa del abono;
- destinatario y moneda del pedido original;
- referencia al número y fecha de la factura original;
- total, base y cuota con signo negativo;
- desglose fiscal por el tipo histórico de cada `OrderDetail`.

El conector **no infiere el IVA dividiendo cuota/base**. Recupera el `TaxCalculator` histórico de la línea original y compara la cuota observada con ese tipo. Se toleran únicamente diferencias de redondeo de hasta dos céntimos; una discrepancia material bloquea el preflight.

Antes de procesar un abono se exige que la factura original tenga `recordId` local. Esto impide emitir una rectificativa huérfana respecto al flujo del bridge.

### MappingProfile rectificativo

La configuración dispone de un ID de perfil rectificativo separado. El ejemplo está en:

`examples/refund-mapping-profile.json`

Ese perfil deja explícitamente `R1–R5` y `S/I` como decisiones **server-side**. PrestaShop aporta el hecho comercial del abono, nunca la clasificación fiscal sensible.

### Flujo manual rectificativo

Para un `OrderSlip`:

1. **Corrective preflight**: valida sin crear registro fiscal.
2. **Create corrective record**: repite preflight y crea el registro solo si pasa.
3. **Refresh corrective status**: reconcilia un `recordId` ya existente.

La clave de idempotencia es estable por tienda + `OrderSlip` + número rectificativo. Si ya existe `recordId`, el módulo bloquea otra creación y obliga a reconciliar.

## Persistencia local

Factura principal:

- tabla `pvf_order_sync`;
- única por `id_shop + id_order`.

Rectificativas:

- tabla `pvf_order_slip_sync`;
- única por `id_shop + id_order_slip`;
- permite múltiples abonos independientes asociados al mismo pedido.

Ambas tablas guardan solo el estado mínimo operativo: `record_id`, idempotencia, estado, último error y fecha de actualización. No almacenan certificados ni lógica fiscal AEAT.

## Semáforo en la ficha del pedido

La tarjeta usa `displayAdminOrderMainBottom` y resume tanto la factura principal como sus rectificativas.

Contrato visual:

- **verde — Synced:** `accepted`;
- **rojo — Action required:** `blocked`, `rejected`, `aeat_rejected`, `failed`;
- **ámbar — Pending / review:** estados intermedios/desconocidos o estados con error local;
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
- una única `OrderInvoice` fiscal por pedido en el flujo actual.

## Instalación de desarrollo

Copia `connectors/prestashop` como módulo `puenteverifactu` dentro de `modules/puenteverifactu/` y actívalo desde el gestor de módulos.

En **Configurar** introduce endpoint HTTPS, MappingProfile de factura, MappingProfile rectificativo, token Bearer y timeout. El token no vuelve a mostrarse después de guardarlo.

## Paquete reproducible

```bash
npm run prestashop:package
npm run prestashop:package:check
```

El ZIP contiene exclusivamente runtime, README y migraciones. Excluye ejemplos, fixtures y tooling. CI lo construye dos veces y exige igualdad byte-a-byte antes de usarlo en las instalaciones reales.

## Upgrade validado

`scripts/ci/prestashop-upgrade-smoke.sh` valida en PrestaShop 8.2.7 el salto **`0.2.0 → 0.3.0`**:

1. instala baseline `0.2.0` con el semáforo ya existente;
2. inserta una fila centinela en `pvf_order_sync`;
3. establece explícitamente ausencia del almacenamiento rectificativo;
4. despliega el ZIP `0.3.0`;
5. ejecuta `prestashop:module upgrade puenteverifactu`;
6. exige que `pvf_order_slip_sync` quede creado y operativo;
7. confirma que `record_id`, idempotencia y estado de la factura original permanecen intactos.

## Gates CI

- `npm run prestashop:contract`: arquitectura, seguridad e invariantes del conector.
- `npm run prestashop:fixtures`: desglose/reconciliación de factura principal.
- `npm run prestashop:rectification-fixtures`: IVA positivo 21/10/4, tolerancia de redondeo y rechazo de incoherencias rectificativas.
- `npm run prestashop:package:check`: ZIP reproducible 0.3.0.
- `scripts/ci/prestashop-compatibility-smoke.sh`: instalación real + factura + `OrderSlip` real en las tres versiones.
- `scripts/ci/prestashop-upgrade-smoke.sh`: migración 0.2.0 → 0.3.0.

## Límites conocidos

- no se fiscalizan automáticamente cambios de estado ni creación de abonos;
- pedidos con varias facturas quedan bloqueados hasta añadir selección explícita por `OrderInvoice`;
- ecotasa queda bloqueada hasta disponer de mapping fiscal específico;
- el smoke runtime de Flashlight usa datos al 0 %, complementados por fixtures deterministas de IVA positivo;
- PrestaShop 9 no está declarado compatible y se evaluará explícitamente antes de incorporarlo.

## Siguiente incremento

1. automatización **opt-in** de eventos, preservando el flujo manual y la idempotencia;
2. aceptación transversal de reconciliación/fallback común entre conectores;
3. Connector Contract Suite específica de las extensiones nativas.

El gate externo AEAT #6 continúa bloqueando cualquier piloto fiscal real o release.
