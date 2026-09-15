# Roadmap

Regla: **finish before advancing**, con la excepción controlada de ADR-0003 para gates exclusivamente externos que sigan bloqueando releases/pilotos.

## Fase 0 — Foundation ✅

- [x] Documentación base.
- [x] Decisiones arquitectónicas iniciales.
- [x] Principio Camaleón y ADR.
- [x] Estructura de repositorio inicial.
- [x] CI mínimo con diagnóstico estructurado.
- [x] Política de ramas/PR.

**Salida cumplida:** repositorio preparado para desarrollar sin decisiones fundamentales implícitas.

## Fase 1 — Canonical Core ✅

- [x] Modelo canónico `InvoiceIntent v1`.
- [x] Schemas versionados.
- [x] Validaciones estructurales y de consistencia.
- [x] `MappingProfile v1`.
- [x] Inferencia de cabeceras ES/EN.
- [x] Preflight sin efectos.
- [x] Decimal exacto.
- [x] Máquina de estados.
- [x] Idempotencia y conflicto por huella.
- [x] Persistencia append-only de referencia en memoria.
- [x] Fixture CSV común y smoke de CI.

**Salida cumplida:** una misma factura produce la misma intención canónica independientemente del canal de entrada; tests, preflight CSV y CI están verdes.

## Fase 2 — Hash & Fiscal Records ✅

- [x] Registro fiscal interno de alta.
- [x] Registro fiscal interno de anulación.
- [x] SHA-256 / `TipoHuella=01` con material AEAT exacto.
- [x] Fixtures oficiales AEAT como pruebas de regresión.
- [x] Encadenamiento único por obligado + SIF + instalación.
- [x] Referencia completa al registro inmediatamente anterior.
- [x] Serialización de concurrencia por cadena.
- [x] Idempotencia de emisión/anulación.
- [x] Timestamp con zona IANA y offset explícito.
- [x] Verificación de registro y cadena.
- [x] Trazabilidad mínima de origen.
- [x] Documentación normativa/técnica.

**Salida cumplida:** cadena reproducible y verificada contra los tres vectores oficiales AEAT de hash. La persistencia durable de esa cadena se incorpora posteriormente en Fase 4 sin alterar el contrato de core.

## Fase 3 — AEAT Test Adapter ⚠️ gate externo diferido

- [x] Manifest de artefactos oficiales/versiones verificadas.
- [x] Endpoints oficiales de pruebas/producción y certificado/sello.
- [x] SOAP 1.1/XML de alta y anulación.
- [x] Cabecera, SIF, encadenamiento, hash y desglose fiscal.
- [x] Recargo de equivalencia a nivel de línea.
- [x] Normalización de respuesta global y por registro.
- [x] Normalización segura de SOAP Fault.
- [x] Protección DTD/XXE.
- [x] Transporte HTTPS mTLS server-side inyectable.
- [x] Guard explícito contra envío accidental a producción.
- [x] `TiempoEsperaEnvio` y control de flujo.
- [x] Outbox/reintentos técnicos de referencia.
- [x] Tests contractuales sin secretos.
- [x] Harness `npm run aeat:gate` con dry-run, doble guard y salida sanitizada.
- [ ] Provisionar certificado válido exclusivamente en entorno seguro.
- [ ] Remisión real controlada al endpoint AEAT de pruebas.
- [ ] Confirmar caso aceptado + rechazo controlado + reconciliación.
- [ ] Documentar evidencia no sensible de la prueba externa.

**Estado:** implementación y harness preparados. El gate externo se difiere bajo ADR-0003 y permanece registrado en #6. Se permite continuar desarrollo, pero **release, piloto fiscal real y production readiness siguen bloqueados** hasta cerrar este gate.

## Fase 4 — Universal Integration Kit ✅

- [x] API framework-neutral v1: preflight, creación y consulta.
- [x] Identidad/tenant resueltos server-side.
- [x] Idempotencia HTTP con conflicto por contenido distinto.
- [x] SDK server-side v1.
- [x] Webhook low-code HMAC + anti-replay.
- [x] Preflight y envío mediante `MappingProfile` server-side.
- [x] Conector de referencia.
- [x] Tests de aislamiento tenant, SDK, webhook e idempotencia.
- [x] Importador CSV reutilizando contrato canónico.
- [x] XLSX read-only sin dependencias externas.
- [x] Inspección unificada CSV/XLSX.
- [x] Asistente de mapping con confianza, revisión explícita, campos pendientes y borrador seguro de `MappingProfile`.
- [x] Contrato UX del wizard de mapping.
- [x] Wizard visual responsive ES/EN de upload → mapping → configuración → preflight.
- [x] Sesiones temporales de importación aisladas por tenant/instalación.
- [x] Allowlist de mappings/configuración y protección prototype-pollution.
- [x] Suite contractual empaquetada para terceros con CLI y gate CI de referencia.
- [x] Adaptador HTTP concreto single-node con Basic/Bearer auth, rate limits, health/readiness y seguridad web.
- [x] Persistencia durable SQLite para cadena fiscal, estado/idempotencia API y sesiones de importación.
- [x] Recuperación de reservas HTTP pendientes tras reinicio.
- [x] Gate CI específico del runtime durable.

**Salida cumplida:** cualquier sistema puede integrarse mediante archivo, webhook, API/SDK o conector sin tocar el motor fiscal. Existe además un deployment single-node ejecutable y durable adecuado para desarrollo, staging y pilotos técnicos no fiscales.

**Límite explícito:** SQLite/rate limit local son un perfil de una sola instancia. Multi-réplica/HA, backups/restauración automatizados y outbox durable de producción se endurecen en Fase 6. El gate AEAT #6 sigue bloqueando piloto fiscal real/release.

## Fase 5 — Kairoseth Extensions ✅

### WooCommerce ✅

- [x] Plugin/conector nativo v1 HPOS-safe basado exclusivamente en WooCommerce CRUD.
- [x] Configuración HTTPS + `MappingProfile` + token Bearer cifrado.
- [x] Modo manual preflight/send/reconcile antes de automatizar.
- [x] Envío asíncrono con Action Scheduler y fallback WP-Cron.
- [x] Idempotencia estable por sitio/pedido y reconciliación por `recordId`.
- [x] Payload neutral minimizado y desglose multirate.
- [x] `taxLineDefaults` server-side para impedir que Woo decida clasificación fiscal.
- [x] Moneda dinámica desde el pedido sin inventar conversión EUR.
- [x] ES/EN y traducción española empaquetada.
- [x] Gate CI HPOS/CRUD/seguridad + sintaxis PHP 7.4.
- [x] Refunds como operaciones rectificativas explícitas e idempotentes.
- [x] Perfil rectificativo separado; Woo no decide `R1–R5` ni `S/I`.
- [x] Numeración fiscal propia obligatoria para cada rectificativa/refund.
- [x] Relación segura con la factura original y preflight previo al envío.
- [x] Semáforo verde/ámbar/rojo agregado para factura + refunds, compatible con HPOS/legacy.
- [x] Matriz automatizada WordPress/WooCommerce/PHP con instalación real, HPOS y smoke CRUD.
- [x] Paquete ZIP reproducible del plugin con allowlist de runtime y SHA-256.
- [x] Contrato server-side auditable de conversión EUR para operaciones en moneda extranjera, con redondeo exacto, reconciliación e idempotencia.

### PrestaShop ✅ alcance nativo v0.4

- [x] Foundation v1 como módulo fino para PrestaShop 1.7.8.x/8.x.
- [x] Configuración por tienda: endpoint HTTPS, `MappingProfile`, timeout y Bearer token cifrado con AES-256-GCM.
- [x] Payload neutral con número fiscal de factura, fecha, moneda, destinatario, totales y desglose por tipos.
- [x] Flujo manual seguro `preflight -> issue -> reconcile` siempre disponible.
- [x] Idempotencia estable por tienda + pedido + número fiscal y bloqueo local de duplicados mediante `recordId`.
- [x] Persistencia mínima de estado/sincronización aislada por tienda.
- [x] Gate contractual CI y sintaxis PHP 7.4.
- [x] Extracción fiscal a nivel `OrderInvoice` usando breakdowns nativos de productos, portes y wrapping.
- [x] Reconciliación al céntimo y fallback explícito para base residual al 0 %, sin inventar cuotas.
- [x] Fixtures de descuentos, portes, wrapping, múltiples tipos de IVA, envío gratuito y redondeo.
- [x] Matriz real de CI con instalación del módulo y payload desde factura nativa en PrestaShop 1.7.8.11/PHP 7.4, 8.1.7/PHP 8.1 y 8.2.7/PHP 8.1.
- [x] Paquete ZIP reproducible con allowlist de runtime, SHA-256, layout legacy compatible y gate real de instalación/upgrade preservando estado local.
- [x] Estado/semáforo integrado en la ficha nativa del pedido mediante `displayAdminOrderMainBottom`, validado en 1.7.8.11/8.1.7/8.2.7.
- [x] Abonos/rectificativas idempotentes basados en `OrderSlip`, con perfil fiscal separado y `R1–R5`/`S/I` exclusivamente server-side.
- [x] Persistencia rectificativa separada por tienda + `OrderSlip`, relación obligatoria con factura original y estado visible en la ficha del pedido.
- [x] Gate real de `OrderSlip::create()` en 1.7.8.11/8.1.7/8.2.7 más fixtures deterministas de IVA 21/10/4 y redondeo.
- [x] Upgrade `0.2.0 → 0.3.0` preservando sincronización de factura y creando almacenamiento de rectificativas.
- [x] Automatización opt-in por tienda para factura y `OrderSlip`, con switches independientes OFF por defecto.
- [x] Eventos nativos `actionOrderStatusPostUpdate` y `actionOrderSlipAdd` reutilizando preflight, idempotencia y reconciliación existentes.
- [x] Upgrade `0.3.0 → 0.4.0` preservando estado principal/rectificativo, registrando hooks y dejando automatización OFF.
- [x] Smoke real que demuestra ausencia de efectos automáticos mientras los switches están desactivados.

### Aceptación transversal ✅

- [x] Reconciliación/fallback end-to-end común entre conectores.
- [x] Tests de compatibilidad y Connector Contract Suite para cada extensión.

**Estado:** Fase 5 técnicamente cerrada. Connector Contract Suite v2 fija y valida la misma semántica sobre WooCommerce y PrestaShop reales: con `recordId` existente solo se consulta/reconcilia y nunca se reemite como fallback; fallos retryable preservan identidad/idempotencia; operaciones nuevas mantienen preflight e idempotencia estable. El gate común ejecuta seis escenarios equivalentes de factura y rectificativa en las matrices reales de ambos conectores. Durante este gate se detectó y corrigió además la compatibilidad de reconciliación de refunds WooCommerce/HPOS usando la abstracción CRUD común `WC_Abstract_Order`.

**Salida cumplida:** conectores nativos WooCommerce y PrestaShop end-to-end técnicamente validados bajo un contrato transversal común. El gate externo AEAT #6 continúa bloqueando cualquier piloto fiscal real o release.

## Fase 6 — Production Readiness 🚧

- [x] Backup/restore SQLite verificable: snapshot WAL consistente, SHA-256 + manifest, `integrity_check`, `foreign_key_check`, restore staging y reemplazo offline protegido.
- [ ] Política operacional de almacenamiento remoto, cifrado, retención, antigüedad y ejercicio periódico de restore.
- [x] Outbox durable AEAT para el perfil single-node: persistencia de estado/backoff/intentos, leases, recuperación tras reinicio y `reconciliation_required` para resultados inciertos sin reemisión ciega.
- [x] Observabilidad y alertas operativas v1: endpoint agregado protegido por `ops:read`, métricas de outbox/backup y códigos `VF_OBS_*` estables sin datos fiscales.
- [ ] Runbooks completos de deploy, rollback, incidente, recuperación y rotación de credenciales.
- [ ] Perfil HA/multi-réplica con store/locking/rate limiting compartidos cuando el despliegue lo requiera.
- [ ] Verificación regulatoria final y evidencia de release por versión.
- [ ] Piloto progresivo con rollback y monitorización activa.

**Estado:** Fase 6 en curso con tres gates internos cubiertos por CI para el perfil single-node: backup/restore SQLite, outbox AEAT durable y observabilidad/alertas v1. Los resultados remotos ambiguos quedan en `reconciliation_required` hasta resolución explícita; el estado operativo global requiere una credencial separada con `ops:read` y expone solo agregados. Esto **no** convierte SQLite en HA ni resuelve por sí solo retención/storage remoto, runbooks completos u operación multi-réplica. Ver `docs/production-readiness.md`, `docs/operations-observability.md` y `packages/sqlite-store/README.md`.

**Gate de entrada a release/piloto:** Fase 3 externa cerrada (#6), además de todos los gates propios de Fase 6 aplicables al perfil de despliegue.

## Posterior

Conectores ERP/CRM adicionales, portal multiempresa, herramientas para asesorías y evaluación separada de NO VERI*FACTU.
