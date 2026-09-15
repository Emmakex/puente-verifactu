# Puente VeriFactu

**Puente VeriFactu** es la capa de integración fiscal de Kairoseth Extensions para conectar sistemas de facturación, ERP, CRM, ecommerce, hojas de cálculo y software propio con **VERI*FACTU / AEAT** sin obligar al negocio a sustituir lo que ya utiliza.

> Estado: Fases 0–2 cerradas; Fase 3 implementada y pendiente únicamente del gate externo AEAT con certificado válido; Fase 4 en desarrollo con API/SDK/webhook universal ya implementados. No usar todavía en producción ni interpretar este repositorio como asesoramiento fiscal o jurídico.

## Principio Camaleón

**El puente se adapta al sistema del cliente; el cliente no debe adaptar su negocio al puente.**

Un autónomo o pyme debe poder empezar desde el nivel técnico que ya tenga:

1. **Cero código:** carga guiada de CSV/Excel y entrada manual asistida.
2. **Low-code:** webhook configurable y perfiles de mapeo.
3. **API universal:** REST con contrato canónico versionado.
4. **SDK:** integración para desarrolladores sin conocer XML AEAT.
5. **Conector nativo:** WordPress/WooCommerce, PrestaShop y sistemas prioritarios.

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
apps/api/                 API/ingress universal del puente
packages/contracts/       Contrato canónico público
packages/core/            Motor fiscal + registros/hash
packages/aeat-adapter/    SOAP/XML, mTLS, respuestas y reintentos AEAT
packages/sdk/             SDK server-side para integradores
packages/diagnostics/     Diagnóstico estructurado
connectors/reference/     Conector de referencia
connectors/file-import/   Entrada cero-código CSV/Excel
scripts/aeat/             Gate seguro de pruebas AEAT
scripts/ci/               Gates y diagnóstico CI
```

## Documentación

Consulta [docs/README.md](docs/README.md). Para integrar un sistema, empieza por [universal-integration-kit-v1.md](docs/universal-integration-kit-v1.md), [integration-strategy.md](docs/integration-strategy.md) y [onboarding-integration.md](docs/onboarding-integration.md).

## Estado normativo de referencia

Documentación revisada el **15 de septiembre de 2026**. Antes de cada release certificable se volverán a validar normativa, esquemas, WSDL, validaciones y FAQ oficiales.

## Desarrollo

Requiere Node.js 22+ para las herramientas del repositorio.

```bash
npm run check
npm test
npm run preflight:demo
npm run aeat:gate
```

Flujo obligatorio: `feature branch -> PR -> CI -> review -> merge -> verificación`.
