# Changelog

Todos los cambios relevantes se documentarán aquí siguiendo un formato compatible con Keep a Changelog y versionado semántico cuando comiencen las releases.

## [Unreleased]

### Added

- PrestaShop Connector v1 foundation para 1.7.8.x/8.x con configuración por tienda, payload neutral y flujo manual `preflight -> issue -> reconcile`.
- Token Bearer del conector PrestaShop cifrado con AES-256-GCM; certificado y lógica AEAT permanecen exclusivamente server-side.
- Idempotencia PrestaShop por tienda/pedido/factura, persistencia local de `recordId`/estado y bloqueo de duplicados antes de reconciliar.
- Gate CI `npm run prestashop:contract` más sintaxis PHP 7.4 para HTTPS/TLS, numeración fiscal nativa, mapping server-side y ausencia de lógica AEAT duplicada.
- ZIP reproducible del conector WooCommerce v0.2 con allowlist de runtime, SHA-256 y gate byte-a-byte.
- Matriz CI real WordPress/WooCommerce/PHP con MySQL, instalación del ZIP, HPOS, hooks y smoke CRUD.
- Documento de compatibilidad WooCommerce con versiones oficiales revisadas el 15/09/2026.
- WooCommerce Connector v0.2: refunds tratados como operaciones rectificativas explícitas e idempotentes mediante un `MappingProfile` server-side separado.
- Numeración fiscal propia para cada refund/rectificativa, relación con factura original y preflight obligatorio antes de emitir.
- Semáforo operativo verde/ámbar/rojo en listados HPOS y legacy, agregado entre factura principal y refunds.
- Mapping nativo seguro de referencias a factura rectificada y bloqueo de `invoiceType` aportado por conectores nativos.
- WooCommerce Connector v1: plugin HPOS-safe con preflight, emisión idempotente asíncrona, reconciliación, token cifrado, fallback CSV/XLSX y UX ES/EN.
- Mapping nativo multirate mediante `taxBreakdown` + `taxLineDefaults` server-side, impidiendo que un conector decida `taxCode`, `regimeKey` u `operationClass`.
- Mapping dinámico de moneda desde sistemas origen sin introducir conversiones fiscales automáticas.
- Gate CI WooCommerce con sintaxis PHP 7.4, declaración HPOS, uso obligatorio de CRUD, transporte HTTPS e invariantes de integración.
- Connector Contract Suite v1 framework-neutral con CLI para que terceros validen preflight, idempotencia, status, no mutación y ausencia de autoridad sensible en su propio CI.
- Gate `npm run contract:reference` usando la misma suite sobre el conector oficial de referencia.
- Wizard cero-código responsive ES/EN para cargar CSV/XLSX, confirmar mappings, completar configuración fija y ejecutar preflight sin enviar a AEAT.
- Sesiones temporales de importación aisladas por organización/instalación con TTL, límites de tamaño y eliminación segura.
- Allowlist de destinos/configuración y hardening contra prototype pollution en cualquier `MappingProfile`.
- Smoke CI end-to-end del onboarding cero-código con diagnóstico estructurado.
- Importador XLSX read-only sin dependencias externas, con selección de hoja, fechas Excel y límites defensivos.
- Mapping Assistant v1 con confianza, revisión explícita, campos pendientes y borrador seguro de `MappingProfile`.
- Inspección unificada CSV/XLSX y smoke CI de mapping asistido.
- Primera entrega de Universal Integration Kit v1: API framework-neutral, SDK server-side, webhook HMAC, preflight/envío mapeado, idempotencia HTTP y conector de referencia.
- ADR-0003 para diferir gates exclusivamente externos sin desbloquear releases/pilotos.
- Harness seguro `npm run aeat:gate` para dry-run y cierre del gate real de pruebas AEAT con doble confirmación de envío y salida sanitizada.
- Adaptador server-side AEAT VERI*FACTU con SOAP 1.1/XML y endpoints oficiales versionados.
- Transporte HTTPS mTLS con guard de producción y credenciales cargadas en runtime.
- Normalización de respuestas, `AceptadoConErrores`, rechazos, duplicados y SOAP Faults.
- Protección DTD/XXE para XML recibido.
- Control de flujo mediante `TiempoEsperaEnvio` y outbox/reintentos técnicos de referencia.
- Recargo de equivalencia a nivel de línea en `InvoiceIntent v1`, mapping, validación, cuota total y XML AEAT.
- Tests contractuales del adaptador sin secretos.
- Registros fiscales internos de alta y anulación.
- Huella AEAT SHA-256 (`TipoHuella=01`) con material exacto y salida hexadecimal en mayúsculas.
- Fixtures oficiales AEAT para primer alta, alta encadenada y anulación encadenada.
- Cadena única por obligado + SIF + instalación, con serialización de concurrencia.
- Idempotencia de fiscalización y verificación de registros/cadenas.
- Generación de timestamp con zona IANA y offset explícito.
- `InvoiceIntent v1` y JSON Schema versionado.
- `MappingProfile v1`, transforms limitados e inferencia de cabeceras ES/EN.
- Preflight CSV sin efectos con reporte por fila.
- Aritmética monetaria exacta para el contrato v1.
- Idempotencia determinista, huella canónica y store append-only de referencia.
- Máquina de estados y validación bilingüe ES/EN.
- Fixtures CSV y smoke test cero-código en CI.
- Foundation técnica con Node.js 22 y gate CI sin dependencias.
- Principio Camaleón con cinco niveles de integración.
- ADR-0002 para integración universal.
- Onboarding por capacidades y concepto versionado `MappingProfile`.
- Estructura inicial de API, contracts, core, diagnostics y conectores.
- Documentación inicial de producto, arquitectura, cumplimiento, seguridad, testing, operación y roadmap.
- ADR-0001: primera versión solo VERI*FACTU.
