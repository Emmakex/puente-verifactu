# Evidencia de release v1

Este gate prepara evidencia reproducible para una versión candidata sin confundir preparación técnica con autorización de release.

Mientras `AEAT_EXTERNAL_GATE_6` siga abierto, el estado obligatorio es `release_blocked`. Un CI verde por sí solo nunca cambia ese estado.

## Contenido de la evidencia

La evidencia fija el commit fuente, versión del producto, perfil de despliegue, blockers, versiones y SHA-256 de los paquetes WooCommerce y PrestaShop, revisión regulatoria, versiones técnicas AEAT y referencia al checklist previo a la declaración responsable.

La herramienta no obtiene datos del entorno de forma implícita. Commit e identificadores CI se proporcionan explícitamente al generar el fichero.

## Comandos

- `npm run release:evidence:check`: valida el contrato interno de evidencia.
- `npm run release:evidence -- --commit <SHA40> --expect release_blocked`: genera la evidencia en salida estándar.
- Puede añadirse `--output dist/release-evidence.json` para crear un fichero. No se sobrescribe un fichero existente.

## Invariantes de CI

El gate comprueba que AEAT #6 bloquea release y piloto fiscal real, que HA figura como no aplicable para el perfil single-node actual, que el registro regulatorio coincide con `AEAT_ARTIFACTS`, que existen las fuentes oficiales mínimas, que la revisión no está caducada y que los fingerprints de los dos paquetes son reproducibles.

`config/regulatory-sources.json` caduca a los 90 días. La caducidad es deliberada para forzar una nueva revisión de las fuentes oficiales antes de releases futuras.

## Cuando se cierre AEAT #6

El cierre futuro exige actualizar el blocker a `closed`, pasar el estado a `release_candidate`, revalidar las fuentes regulatorias, ejecutar CI completo en el commit candidato, generar evidencia nueva para ese mismo commit y preparar la declaración responsable final de esa versión a partir del checklist `docs/release/declaracion-responsable-template.md`.

No se debe declarar una versión apta para producción si evidencia, CI, revisión regulatoria y gate externo no corresponden al mismo estado de código.
