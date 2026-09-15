# Roadmap

Regla: **finish before advancing**.

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

## Fase 3 — AEAT Test Adapter

- artefactos oficiales versionados;
- certificado de pruebas;
- transporte/normalización;
- reintentos/outbox;
- pruebas externas.

**Salida:** aceptación real en entorno de pruebas AEAT.

## Fase 4 — Universal Integration Kit

- API/SDK estable;
- webhook low-code;
- importador CSV y mapping UI/contract;
- XLSX;
- suite contractual;
- conector de referencia.

**Salida:** sistema nuevo integrable sin tocar el motor fiscal.

## Fase 5 — Kairoseth Extensions

- WordPress/WooCommerce;
- PrestaShop;
- UX ES/EN;
- reconciliación y fallback;
- tests de compatibilidad.

**Salida:** pilotos end-to-end controlados.

## Fase 6 — Production Readiness

Hardening, persistencia durable, backups/restauración, observabilidad/alertas, runbooks, verificación regulatoria final, declaración responsable por versión y piloto progresivo.

## Posterior

Conectores ERP/CRM, portal multiempresa, herramientas para asesorías y evaluación separada de NO VERI*FACTU.
