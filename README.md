# Puente VeriFactu

**Puente VeriFactu** es la capa de integración fiscal de Kairoseth Extensions para conectar sistemas de facturación, ERP, CRM, ecommerce, hojas de cálculo y software propio con **VERI*FACTU / AEAT** sin obligar al negocio a sustituir lo que ya utiliza.

> Estado: Fases 0–2 cerradas; Fase 3 implementada y pendiente únicamente del gate externo AEAT con certificado válido; Fase 4 cerrada con API/SDK/webhook, CSV/XLSX, onboarding cero-código, runtime HTTP y persistencia durable single-node; Fase 5 técnicamente cerrada con WooCommerce y PrestaShop `0.4.0` validados bajo Connector Contract Suite v2. Fase 6 está en curso y ya incorpora backup/restore SQLite verificable, outbox AEAT durable single-node con leases, cuarentena `reconciliation_required`, reconciliación oficial por `ConsultaFactuSistemaFacturacion`, CLI operativo read-only/apply con doble guard y semilla controlada para demostrar reconciliación real a partir de una única remisión aceptada, sin reemisión ciega. No usar todavía en producción: el gate externo AEAT #6 y los gates restantes de Production Readiness siguen bloqueando release/piloto fiscal real. Este repositorio no constituye asesoramiento fiscal o jurídico.

## Principio Camaleón

**El puente se adapta al sistema del cliente; el cliente no debe adaptar su negocio al puente.**

Un autónomo o pyme debe poder empezar desde el nivel técnico que ya tenga:

1. **Cero código:** wizard visual para cargar CSV/XLSX, confirmar columnas y validar sin enviar a AEAT.
2. **Low-code:** webhook configurable y perfiles de mapeo.
3. **API universal:** REST con contrato canónico versionado.
4. **SDK:** integración para desarrolladores sin conocer XML AEAT.
5. **Conector nativo:** WordPress/WooCommerce, PrestaShop y sistemas prioritarios, validados con una suite contractual común.

Todos los caminos terminan en el mismo modelo canónico y el mismo motor fiscal. Ningún conector replica la lógica regulatoria.

## Objetivo

Construir un núcleo reutilizable que reciba operaciones desde sistemas heterogéneos, las transforme de forma determinista al contrato canónico, aplique las reglas necesarias, genere los registros fiscales, mantenga su encadenamiento y los remita a AEAT mediante un único adaptador oficial.

La primera etapa será **solo VERI*FACTU**. El modo NO VERI*FACTU queda fuera del MVP.

## Principios de ingeniería

- Independencia absoluta respecto al software origen.
- Onboarding por capacidades: preguntamos qué puede hacer el sistema, no qué marca es.
- Configuración guiada y validación previa antes de enviar nada a AEAT.
- El sistema origen no decide reglas fiscales sensibles ni credenciales.
- Historial fiscal finalizado inmutable; las correcciones generan operaciones nuevas.
- Idempotencia obligatoria de extremo a extremo.
- Credenciales/certificados AEAT exclusivamente server-side y fuera del repositorio.
- Automatizaciones nativas opt-in y desactivadas por defecto cuando puedan crear operaciones fiscales.
- Backup sin restore probado no cuenta como capacidad de recuperación.
- Un resultado AEAT incierto nunca se reenvía automáticamente: se consulta el estado oficial y, si no hay confirmación exacta, permanece en `reconciliation_required`.
- ES/EN juntos en interfaces de cliente.
- Todo fallo de CI, build, test, deploy o runtime genera diagnóstico estructurado accionable.
- `finish before advancing`, salvo gate exclusivamente externo diferido mediante ADR y manteniendo bloqueo de release/piloto.

## Estructura

```text
apps/api/                          API/ingress universal del puente
apps/onboarding/                   Wizard cero-código responsive ES/EN
apps/server/                       Runtime HTTP single-node
packages/contracts/                Contrato canónico público
packages/core/                     Motor fiscal + registros/hash + mapping assistant
packages/aeat-adapter/             SOAP/XML, mTLS, remisión, consulta oficial y reconciliación AEAT
packages/sdk/                      SDK server-side para integradores
packages/sqlite-store/             Persistencia durable + backup/restore + outbox single-node
packages/connector-contract-suite/ Gate de compatibilidad para conectores terceros
packages/diagnostics/              Diagnóstico estructurado
connectors/reference/              Conector de referencia
connectors/file-import/            Entrada cero-código CSV/XLSX
connectors/woocommerce/            Conector nativo WooCommerce
connectors/prestashop/             Conector nativo PrestaShop
scripts/aeat/                      Gate y reconciliación segura de pruebas AEAT
scripts/ops/                       Operaciones y recuperación
scripts/ci/                        Gates y diagnóstico CI
scripts/release/                   Empaquetado reproducible de extensiones
```

## Documentación

Consulta [docs/README.md](docs/README.md). Para integrar un sistema, empieza por [universal-integration-kit-v1.md](docs/universal-integration-kit-v1.md), [mapping-assistant-v1.md](docs/mapping-assistant-v1.md), [integration-strategy.md](docs/integration-strategy.md) y [onboarding-integration.md](docs/onboarding-integration.md). El wizard visual está documentado en `apps/onboarding/README.md`, el runtime en `apps/server/README.md`, backup/restore y outbox durable en `packages/sqlite-store/README.md`, los gates de producción en `docs/production-readiness.md`, el gate AEAT en `docs/aeat-live-gate.md`, el procedimiento de incidentes/reconciliación en `docs/runbooks/aeat-incident-reconciliation.md`, la validación de conectores en `packages/connector-contract-suite/README.md`, WooCommerce en `connectors/woocommerce/README.md` y PrestaShop en `connectors/prestashop/README.md`.

## Estado normativo de referencia

Documentación revisada el **15 de septiembre de 2026**. Antes de cada release certificable se volverán a validar normativa, esquemas, WSDL, validaciones y FAQ oficiales.

## Desarrollo

Requiere Node.js 22.13+ para las herramientas actuales del repositorio. Los gates de conectores validan además sintaxis PHP 7.4. WooCommerce dispone de matriz real WordPress/WooCommerce y ZIP reproducible. PrestaShop dispone de contrato estático, fixtures de factura y rectificativa, ZIP reproducible, upgrade smoke y matriz real en PrestaShop 1.7.8.11/PHP 7.4, 8.1.7/PHP 8.1 y 8.2.7/PHP 8.1. Connector Contract Suite v2 añade un gate nativo común de seis escenarios para factura y rectificativa. El perfil SQLite single-node dispone además de backup/restore verificado y outbox AEAT durable: snapshot consistente, SHA-256 + manifest, chequeo de integridad/foreign keys, restore con staging, persistencia de backoff/intentos y leases de dispatch. Los resultados remotos ambiguos quedan en `reconciliation_required`; el reconciliador oficial consulta AEAT por `PeriodoImputacion` + `RefExterna` y solo completa ante coincidencia exacta de identidad y huella. `aeat:reconcile` permite ejecutar esa consulta sobre un job durable: inspección read-only por defecto y persistencia del cierre únicamente con `--apply` + `AEAT_RECONCILIATION_APPLY=YES`. El live gate puede crear opcionalmente una semilla privada `reconciliation_required` después de una remisión aceptada real para demostrar la consulta con la misma identidad/huella y **sin añadir otra remisión**.

```bash
npm run check
npm test
npm run preflight:demo
npm run mapping:demo
npm run onboarding:smoke
npm run contract:reference
npm run native:contract:v2
npm run runtime:smoke
npm run sqlite:backup:smoke
npm run sqlite:backup -- --db <source.sqlite> --out <backup.sqlite>
npm run sqlite:verify-backup -- --backup <backup.sqlite>
npm run sqlite:restore -- --backup <backup.sqlite> --db <target.sqlite>
npm run aeat:cert:check
npm run aeat:evidence:verify -- --accepted <accepted.json> --rejected <rejected.json> --source-commit <SHA40>
npm run aeat:reconciliation:smoke
npm run aeat:reconcile -- --db <runtime.sqlite> --job-id <job-id>
npm run aeat:seed:smoke
npm run aeat:outbox:smoke
npm run woo:contract
npm run woo:package:check
npm run woo:package
npm run prestashop:contract
npm run prestashop:fixtures
npm run prestashop:rectification-fixtures
npm run prestashop:package:check
npm run aeat:gate
```

Flujo obligatorio: `feature branch -> PR -> CI -> review -> merge -> verificación`.
