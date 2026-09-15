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

## Fase 1 — Canonical Core

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

**Criterio de salida:** tests + preflight CSV + CI deben estar verdes antes de marcar esta fase cerrada en `main`.

**Salida funcional:** una misma factura puede producir la misma intención canónica independientemente del canal de entrada.

## Fase 2 — Hash & Fiscal Records

- registros necesarios para MVP;
- encadenamiento/hash con fixtures oficiales;
- concurrencia/serialización;
- auditoría.

**Salida:** cadena reproducible y verificada.

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

Hardening, backups/restauración, observabilidad/alertas, runbooks, verificación regulatoria final, declaración responsable por versión y piloto progresivo.

## Posterior

Conectores ERP/CRM, portal multiempresa, herramientas para asesorías y evaluación separada de NO VERI*FACTU.
