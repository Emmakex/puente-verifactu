# ADR-0002 — Arquitectura de integración camaleónica

- Estado: Accepted
- Fecha: 2026-09-15

## Contexto

El mercado objetivo incluye autónomos y pymes con niveles tecnológicos muy distintos. Exigir un ERP concreto, una API moderna o cambiar el flujo de facturación limitaría la adopción y convertiría el puente en otro software vertical.

## Decisión

El producto ofrecerá una escalera permanente de integración: manual asistido, archivo, webhook/low-code, API/SDK y conectores nativos. Todos convergen en un único contrato canónico y pasan por el mismo preflight y motor fiscal.

## Consecuencias

- Siempre existe una ruta universal aunque el software origen no tenga API.
- Los conectores específicos son optimizaciones, no dependencias del producto.
- Los perfiles de mapeo pasan a ser un concepto versionado de primera clase.
- Debemos probar el mismo caso fiscal independientemente del canal de entrada.
- La UX y los mensajes de error forman parte del contrato de integración.

## Prohibiciones

- No crear motores fiscales distintos por plataforma.
- No requerir cambiar de ERP para utilizar el puente.
- No aceptar mappings que puedan saltarse invariantes del núcleo.
- No enviar datos reales durante el aprendizaje/configuración de un mapping.
