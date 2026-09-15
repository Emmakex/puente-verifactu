# Roadmap

Regla: **finish before advancing**.

## Fase 0 — Foundation

- [x] Documentación base.
- [x] Decisiones arquitectónicas iniciales.
- [x] Principio Camaleón y ADR.
- [x] Estructura de repositorio inicial.
- [x] CI mínimo con diagnóstico estructurado.
- [x] Política de ramas/PR.

**Salida:** repositorio preparado para desarrollar sin decisiones fundamentales implícitas.

## Fase 1 — Canonical Core

- modelo canónico v1;
- schema y validaciones;
- `MappingProfile` v1;
- preflight sin efectos;
- decimal exacto;
- máquina de estados;
- idempotencia;
- persistencia append-only lógica;
- fixtures comunes a todos los canales.

**Salida:** una misma factura produce la misma intención fiscal independientemente de si llega por archivo, webhook, API o conector.

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
