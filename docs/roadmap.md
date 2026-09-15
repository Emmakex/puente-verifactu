# Roadmap

La regla es **finish before advancing**: no se abre la siguiente fase si la anterior no tiene implementación, gates, aceptación, bloqueos y documentación cerrados.

## Fase 0 — Foundation

- Documentación base.
- Decisiones arquitectónicas iniciales.
- Estructura de repositorio.
- CI mínimo y diagnóstico estructurado.
- Política de ramas/PR.

**Salida:** repositorio preparado para desarrollar sin decisiones fundamentales implícitas.

## Fase 1 — Canonical Core

- Modelo canónico v1.
- Validaciones básicas.
- Decimal exacto.
- Máquina de estados.
- Idempotencia.
- Persistencia append-only lógica.

**Salida:** una factura puede convertirse determinísticamente en una intención fiscal estable sin AEAT.

## Fase 2 — Hash & Fiscal Records

- Registros de alta/anulación necesarios para MVP.
- Encadenamiento y hash con fixtures oficiales.
- Concurrencia/serialización por SIF/tenant.
- Auditoría.

**Salida:** cadena reproducible y verificada.

## Fase 3 — AEAT Test Adapter

- Artefactos oficiales versionados.
- Certificado de pruebas.
- Transporte y normalización de respuestas.
- Reintentos/outbox.
- Pruebas externas.

**Salida:** aceptación real en entorno de pruebas AEAT y rechazos correctamente interpretados.

## Fase 4 — Connector SDK

- SDK/API estable.
- Webhooks/polling.
- Suite contractual para terceros.
- Conector de referencia.

**Salida:** integrar una plataforma nueva sin tocar el motor fiscal.

## Fase 5 — Kairoseth Extension WordPress/WooCommerce

- Mapping WooCommerce.
- Ciclo de expedición y estados.
- UX ES/EN.
- Reconciliación y soporte.
- Tests de compatibilidad.

**Salida:** piloto end-to-end controlado.

## Fase 6 — Production Readiness

- Hardening seguridad.
- backups/restauración;
- observabilidad/alertas;
- runbooks;
- verificación regulatoria final;
- declaración responsable por versión;
- piloto real progresivo.

## Posterior

PrestaShop, conectores ERP/CRM, API comercial, portal multiempresa, herramientas para asesores y, solo como iniciativa separada, evaluación de modo NO VERI*FACTU.
