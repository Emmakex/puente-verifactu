# Puente VeriFactu

**Puente VeriFactu** es la capa de integración fiscal de Kairoseth Extensions para conectar sistemas de facturación, ERP, CRM, ecommerce y software propio con **VERI*FACTU / AEAT** sin acoplar la lógica fiscal a una plataforma concreta.

> Estado: diseño y documentación inicial. No usar todavía en producción ni interpretar este repositorio como asesoramiento fiscal o jurídico.

## Objetivo

Construir un núcleo reutilizable que reciba eventos de facturación desde distintos sistemas, los transforme a un modelo canónico, aplique las reglas necesarias, genere los registros de facturación exigidos, mantenga su encadenamiento y los remita a AEAT mediante un adaptador oficial.

La primera etapa del producto será **solo VERI*FACTU**. No implementaremos inicialmente modo NO VERI*FACTU, porque este añade obligaciones adicionales de firma, registro de eventos, comprobaciones y conservación local. Esta decisión reduce superficie de riesgo y simplifica la validación inicial.

## Principios

- El núcleo fiscal es independiente de WordPress, WooCommerce, PrestaShop, ERP o CRM.
- Cada plataforma se integra mediante un adaptador con contrato estable.
- El sistema origen no puede decidir reglas fiscales sensibles ni credenciales.
- Los registros fiscales confirmados son inmutables; las correcciones crean nuevos registros.
- La idempotencia es obligatoria en todos los puntos de entrada y salida.
- ES/EN se entregan conjuntamente cuando exista interfaz de cliente.
- Todo fallo de CI, build, test, deploy o runtime genera diagnóstico accionable y estructurado.
- Fase N+1 no comienza hasta cerrar implementación, gates, aceptación, bloqueos y documentación de la fase N.

## Documentación

- [Índice documental](docs/README.md)
- [Visión y alcance](docs/product-scope.md)
- [Arquitectura](docs/architecture.md)
- [Cumplimiento y referencias normativas](docs/compliance.md)
- [Modelo de dominio y API](docs/api-contract.md)
- [Conectores y adaptadores](docs/connectors.md)
- [Seguridad y privacidad](docs/security.md)
- [Testing y calidad](docs/testing-quality.md)
- [Operación, observabilidad y diagnóstico](docs/operations-observability.md)
- [Roadmap](docs/roadmap.md)
- [Reglas globales de ingeniería](docs/engineering-rules.md)
- [ADR-0001: MVP solo VERI*FACTU](docs/adr/0001-verifactu-only-mvp.md)

## Estado normativo de referencia

Documentación revisada el **15 de septiembre de 2026**. Según AEAT y el Real Decreto-ley 15/2025, la adaptación obligatoria de los SIF está prevista antes del **1 de enero de 2027** para contribuyentes del Impuesto sobre Sociedades y antes del **1 de julio de 2027** para el resto de obligados incluidos. Antes de cada release certificable se deberá volver a validar normativa, esquemas, WSDL, validaciones y FAQ oficiales.

## Flujo de desarrollo

`feature branch -> PR -> CI -> review -> merge -> verificación`

No se aceptan cambios funcionales importantes directamente en `main`.
