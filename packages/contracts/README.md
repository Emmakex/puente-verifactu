# Contracts

Contratos públicos y versionados de Puente VeriFactu.

## Fase 1

- `schemas/invoice-intent.v1.schema.json`: modelo canónico de factura previo a fiscalización.
- `schemas/mapping-profile.v1.schema.json`: formato portable de mapeo.
- `src/constants.mjs`: enums compartidos sin acoplar conectores al motor fiscal.

Cambios incompatibles requieren nueva versión del contrato; no se modificará silenciosamente el significado de v1.
