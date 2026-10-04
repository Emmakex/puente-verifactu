# Evidencia de release v1

Este gate prepara evidencia reproducible para una versión candidata sin confundir preparación técnica con autorización de release.

`AEAT_EXTERNAL_GATE_6` quedó cerrado el 2026-10-03 con evidencia externa sanitizada ligada al commit probado. El estado de gates pasa a `release_candidate`; esto no equivale a publicar ni autorizar producción. La declaración responsable definitiva de la versión sigue siendo obligatoria antes de publicación.

## Contenido de la evidencia

La evidencia fija el commit fuente, versión del producto, perfil de despliegue `kairoseth-hostinger-mongodb`, blockers, versiones y SHA-256 de los paquetes WooCommerce y PrestaShop, revisión regulatoria, versiones técnicas AEAT y referencia al checklist previo a la declaración responsable.

La herramienta no obtiene datos del entorno de forma implícita. Commit e identificadores CI se proporcionan explícitamente al generar el fichero.

## Comandos

- `npm run release:evidence:check`: valida el contrato interno de evidencia.
- `npm run release:evidence -- --commit <SHA40> --expect release_candidate`: genera la evidencia en salida estándar.
- Puede añadirse `--output dist/release-evidence.json` para crear un fichero. No se sobrescribe un fichero existente.

## Invariantes de CI

El gate comprueba que AEAT #6 figura cerrado, que no quedan blockers abiertos para `release_candidate`, que el deployment profile es exactamente `kairoseth-hostinger-mongodb`, que HA de aplicación figura como no aplicable para el piloto actual, que el registro regulatorio coincide con `AEAT_ARTIFACTS`, que la revisión no está caducada y que los fingerprints de los paquetes son reproducibles.

`config/regulatory-sources.json` caduca a los 90 días. La caducidad es deliberada para forzar una nueva revisión de las fuentes oficiales antes de releases futuras.

## Después del cierre de AEAT #6

El blocker figura `closed` y el estado es `release_candidate`. Antes de publicar una versión se deben mantener vigentes las fuentes regulatorias, ejecutar CI completo sobre el commit candidato final, generar evidencia de release para ese mismo commit y preparar/aprobar la declaración responsable final a partir del checklist `docs/release/declaracion-responsable-template.md`. La evidencia externa de #6 se conserva en `docs/release/aeat-gate-6-evidence-2026-10-03.md`.

No se debe declarar una versión apta para producción si evidencia, CI, revisión regulatoria y gate externo no corresponden al mismo estado de código.

## Perfil productivo v0.1.0

La evidencia final v0.1.0 no es válida si declara `sqlite-single-node`. SQLite se conserva como perfil `standalone` de desarrollo/test/referencia, mientras que el candidato productivo se despliega sobre Kairoseth / Hostinger con persistencia MongoDB inyectada.
