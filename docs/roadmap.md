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

**Salida cumplida:** cadena reproducible y verificada contra los tres vectores oficiales AEAT de hash. El store en memoria sigue siendo una referencia; la persistencia durable/productiva es un gate obligatorio antes del piloto real.

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

**Estado:** implementación y harness preparados. El gate externo se difiere bajo ADR-0003 y permanece registrado en #6. Se permite continuar desarrollo de Fase 4, pero **release, piloto fiscal real y production readiness siguen bloqueados** hasta cerrar este gate.

## Fase 4 — Universal Integration Kit 🚧

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
- [x] Asistente de mapping con confianza y confirmación explícita.
- [x] Contrato UX del wizard de mapping.
- [ ] UI visual ES/EN del wizard.
- [ ] Suite contractual empaquetada para terceros.
- [ ] Adaptador HTTP/deployment concreto con autenticación real y rate limits.
- [ ] Persistencia durable del estado API.

**Estado:** entrada universal por API, webhook, CSV y XLSX ya implementada. El siguiente bloque customer-facing es la UI visual del wizard; la fase continúa abierta.

**Salida:** sistema nuevo integrable sin tocar el motor fiscal.

## Fase 5 — Kairoseth Extensions

- WordPress/WooCommerce;
- PrestaShop;
- UX ES/EN;
- reconciliación y fallback;
- tests de compatibilidad.

**Salida:** pilotos end-to-end controlados, sujetos al cierre previo del gate AEAT #6.

## Fase 6 — Production Readiness

Hardening, persistencia durable, outbox durable, backups/restauración, observabilidad/alertas, runbooks, verificación regulatoria final, declaración responsable por versión y piloto progresivo.

**Gate de entrada a release/piloto:** Fase 3 externa cerrada, además de todos los gates propios de Fase 6.

## Posterior

Conectores ERP/CRM, portal multiempresa, herramientas para asesorías y evaluación separada de NO VERI*FACTU.
