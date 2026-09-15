# Checklist previo a la declaración responsable de una versión

Este archivo es una **plantilla interna de preparación**. No constituye una declaración responsable, no está firmado y no debe presentarse ni publicarse como certificación del producto.

## Datos que deben quedar fijados para cada versión

- Nombre del sistema: `Puente VeriFactu`
- Versión del SIF: `<VERSION_SIF>`
- Commit/build: `<COMMIT_SHA>`
- Modalidad: `VERI*FACTU`
- Componentes incluidos: `<COMPONENTES>`
- Perfil de instalación: `<PERFIL_DESPLIEGUE>`
- Funcionalidades fiscales incluidas: `<FUNCIONALIDADES>`
- Razón social del productor: `<RAZON_SOCIAL>`
- NIF del productor: `<NIF>`
- Dirección y contacto del productor: `<DIRECCION_Y_CONTACTO>`
- Lugar y fecha: `<LUGAR_Y_FECHA>`
- Persona firmante y cargo: `<FIRMANTE_Y_CARGO>`

## Evidencia técnica previa obligatoria

Antes de preparar el documento final de la versión:

- generar la evidencia de release para el commit exacto;
- verificar CI completo verde para ese mismo commit;
- conservar hashes SHA-256 de los artefactos distribuibles;
- confirmar que la revisión regulatoria sigue vigente;
- cerrar el gate externo AEAT #6 con evidencia no sensible;
- revisar QR, textos y comportamiento VERI*FACTU de la versión candidata;
- comprobar que el paquete de evidencia no contiene secretos, certificados ni datos fiscales reales.

## Regla de publicación

La declaración final de cada versión debe prepararse y aprobarse separadamente a partir de este checklist, quedar vinculada a una versión concreta y ponerse a disposición del usuario conforme a las reglas aplicables. El producto no debe presentarse como “certificado por AEAT”.
