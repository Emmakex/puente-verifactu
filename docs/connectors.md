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

## Prohibiciones

- Construir XML AEAT por su cuenta.
- Elegir endpoints AEAT arbitrariamente.
- Acceder a certificados de otra organización.
- Conceder roles/permisos desde cliente.
- Convertir rechazo en aceptación.
- Crear otro registro cuando lo correcto es reintentar el existente.
- Modificar un mapping activo silenciosamente.

## Prioridad de adaptadores

1. `reference`: especificación ejecutable del contrato.
2. `file-import`: CSV/XLSX y fallback universal.
3. WordPress + WooCommerce — primera implementación nativa de Fase 5.
4. PrestaShop — segunda implementación nativa, foundation v1 en curso.
5. REST/webhook universal.
6. ERP/CRM prioritarios según demanda real.

## Conectores nativos

Son capas cliente ligeras. Deben capturar el evento correcto del sistema origen, mapear datos y mostrar estado. La lógica fiscal, credenciales AEAT y transporte oficial permanecen en el puente.

### WooCommerce v1

El primer conector nativo sigue estas reglas adicionales:

- HPOS declarado compatible y acceso a pedidos solo mediante WooCommerce CRUD;
- operación HTTP fuera del cambio síncrono de estado mediante Action Scheduler, con fallback de evento único WP-Cron;
- preflight antes de emitir;
- clave idempotente estable por sitio + pedido;
- `recordId` persistido en metadata del pedido y posteriores eventos convertidos en reconciliación, no en nuevas emisiones silenciosas;
- token del Puente cifrado en WordPress y nunca guardado en metadata de pedido/logs;
- payload minimizado: sin email, teléfono o dirección completa salvo futura necesidad contractual explícita;
- NIF/CIF configurable mediante la meta-key que el comercio ya utilice, sin acoplarse a un plugin de terceros;
- múltiples tipos de IVA representados como `tax_lines[]` de origen;
- el origen solo puede aportar `rate`, `baseAmount`, `taxAmount` y, cuando aplique, datos de recargo;
- `taxCode`, `regimeKey` y `operationClass` se añaden exclusivamente server-side mediante `MappingProfile.taxLineDefaults`;
- moneda tomada del pedido; cualquier conversión fiscal a EUR sigue siendo responsabilidad explícita del motor, nunca una estimación del plugin;
- fallback CSV/XLSX documentado para mantener operatividad si una actualización de WooCommerce rompe temporalmente el conector.

Reembolsos/rectificaciones son operaciones fiscales explícitas y no se derivan automáticamente de una edición posterior del pedido.

### PrestaShop v1 foundation

El segundo conector nativo comienza deliberadamente en modo manual para reducir riesgo durante la primera matriz real de compatibilidad:

- alcance declarado inicial PrestaShop 1.7.8.x y 8.x;
- configuración aislada por tienda de endpoint HTTPS, `MappingProfile` y timeout;
- token Bearer cifrado localmente con AES-256-GCM y clave derivada de `_COOKIE_KEY_`;
- número de factura obtenido del número fiscal nativo de PrestaShop, nunca de la mera referencia del pedido;
- payload neutral con moneda de origen y desglose `tax_lines[]`; cualquier conversión fiscal no-EUR → EUR se resuelve server-side;
- flujo explícito `preflight -> issue -> reconcile`; la emisión solo se habilita si el preflight pasa;
- `Idempotency-Key` estable por tienda + pedido + factura y `recordId` persistido localmente para impedir duplicados;
- aislamiento de pedidos por `id_shop` antes de ejecutar acciones manuales;
- no existe todavía automatización de estados, abonos ni rectificativas hasta superar los siguientes gates de extracción/compatibilidad;
- promociones complejas, portes y wrapping se consideran casos de prueba obligatorios antes de cerrar el conector.

El certificado AEAT no entra nunca en PrestaShop. Igual que en WooCommerce, el módulo no construye XML ni decide clasificación fiscal sensible.

## Suite contractual

Todos los canales deben pasar los mismos escenarios relevantes: alta, duplicado, corrección, rechazo, timeout, reintento, caída, datos incompletos, decimales, recuperación y cambio de mapping.

Los conectores nativos añaden gates de plataforma. Para WooCommerce se valida sintaxis PHP, declaración HPOS, ausencia de accesos directos a tablas/post-meta, preflight antes de emisión, idempotencia, transporte HTTPS y ausencia de lógica AEAT duplicada.

Para PrestaShop la foundation valida desde CI: rango declarado de versiones, HTTPS/TLS, token cifrado, número fiscal nativo, idempotencia, estado local por tienda, desglose tributario neutral y ausencia de XML/SOAP/certificados dentro del módulo. La matriz de instalación real se añade como siguiente gate antes de declarar compatibilidad cerrada.
