# Puente VeriFactu

**Puente VeriFactu** es la capa de integración fiscal de Kairoseth Extensions para conectar sistemas de facturación, ERP, CRM, ecommerce, hojas de cálculo y software propio con **VERI*FACTU / AEAT** sin obligar al negocio a sustituir lo que ya utiliza.

> Estado: Fases 0–2 cerradas; Fase 3 implementada y pendiente únicamente del gate externo AEAT con certificado válido; Fase 4 cerrada con API/SDK/webhook, CSV/XLSX, onboarding cero-código, runtime HTTP y persistencia durable single-node; Fase 5 en desarrollo con la primera base nativa para WooCommerce. No usar todavía en producción ni interpretar este repositorio como asesoramiento fiscal o jurídico.

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
packages/aeat-adapter/             SOAP/XML, mTLS, respuestas y reintentos AEAT
packages/sdk/                      SDK server-side para integradores
packages/sqlite-store/             Persistencia durable single-node
packages/connector-contract-suite/ Gate de compatibilidad para conectores terceros
packages/diagnostics/              Diagnóstico estructurado
connectors/reference/              Conector de referencia
connectors/file-import/            Entrada cero-código CSV/XLSX
connectors/woocommerce/            Primer conector nativo WooCommerce
scripts/aeat/                      Gate seguro de pruebas AEAT
scripts/ci/                        Gates y diagnóstico CI
```

## Documentación

Consulta [docs/README.md](docs/README.md). Para integrar un sistema, empieza por [universal-integration-kit-v1.md](docs/universal-integration-kit-v1.md), [mapping-assistant-v1.md](docs/mapping-assistant-v1.md), [integration-strategy.md](docs/integration-strategy.md) y [onboarding-integration.md](docs/onboarding-integration.md). El wizard visual está documentado en `apps/onboarding/README.md`, el runtime en `apps/server/README.md`, la validación de conectores en `packages/connector-contract-suite/README.md` y WooCommerce en `connectors/woocommerce/README.md`.

## Estado normativo de referencia

Documentación revisada el **15 de septiembre de 2026**. Antes de cada release certificable se volverán a validar normativa, esquemas, WSDL, validaciones y FAQ oficiales.

## Desarrollo

Requiere Node.js 22.13+ para las herramientas actuales del repositorio. El gate del conector WooCommerce valida además sintaxis PHP 7.4.

```bash
npm run check
npm test
npm run preflight:demo
npm run mapping:demo
npm run onboarding:smoke
npm run contract:reference
npm run runtime:smoke
npm run woo:contract
npm run aeat:gate
```

Flujo obligatorio: `feature branch -> PR -> CI -> review -> merge -> verificación`.
