# Índice documental

Este directorio es la fuente de verdad funcional, técnica y normativa de Puente VeriFactu.

| Documento | Propósito |
|---|---|
| `product-scope.md` | Problema, usuarios, alcance MVP y exclusiones |
| `architecture.md` | Arquitectura, componentes, límites y flujos |
| `integration-strategy.md` | Principio Camaleón y cinco niveles de integración |
| `onboarding-integration.md` | Onboarding universal orientado a autónomos y pymes |
| `canonical-core-v1.md` | Contrato ejecutable InvoiceIntent/MappingProfile/preflight v1 |
| `mapping-assistant-v1.md` | XLSX/CSV, confianza de mapeo y wizard de configuración |
| `fiscal-records-v1.md` | Registros alta/anulación, hash AEAT, encadenamiento e idempotencia |
| `euro-conversion-v1.md` | Conversión fiscal no-EUR → EUR, auditoría, redondeo e idempotencia |
| `aeat-test-adapter-v1.md` | SOAP/XML, mTLS, respuestas, reintentos y gate externo de pruebas AEAT |
| `aeat-live-gate.md` | Runbook y comando seguro para cerrar la prueba real de Fase 3 |
| `universal-integration-kit-v1.md` | API/SDK, webhook low-code y patrón camaleónico de integración |
| `woocommerce-compatibility.md` | Matriz WP/Woo/PHP, HPOS y ZIP reproducible del conector WooCommerce |
| `compliance.md` | Marco normativo, obligaciones y checklist de release |
| `release-evidence.md` | Manifest reproducible, blockers, revisión regulatoria y fingerprints de release |
| `release/declaracion-responsable-template.md` | Checklist interno previo a la declaración responsable definitiva de una versión |
| `api-contract.md` | Modelo canónico, idempotencia y contratos |
| `connectors.md` | Contrato de adaptadores y estrategia por plataforma |
| `security.md` | Credenciales, tenants, secretos, amenazas y privacidad |
| `testing-quality.md` | Pirámide de pruebas y gates |
| `operations-observability.md` | Logs, métricas, trazas, reintentos y diagnósticos |
| `production-readiness.md` | Gates de Fase 6, backup/restore, HA, runbooks y criterios de release |
| `roadmap.md` | Fases de implementación y criterios de salida |
| `engineering-rules.md` | Reglas globales de ingeniería |
| `adr/` | Decisiones arquitectónicas persistentes |

## Regla documental

Todo cambio que altere un contrato, comportamiento fiscal, flujo de datos, requisito regulatorio, onboarding, operación o decisión arquitectónica debe actualizar la documentación correspondiente en el mismo PR.
