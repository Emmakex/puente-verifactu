# Cumplimiento y referencias normativas

> Documento técnico de ingeniería. No sustituye asesoramiento fiscal o jurídico.

## Marco de referencia

Fuentes oficiales que deben considerarse fuente de verdad antes de cada release:

- Ley 58/2003, General Tributaria, art. 29.2.j.
- Ley 11/2021, de prevención y lucha contra el fraude fiscal.
- Real Decreto 1007/2023, Reglamento de requisitos de los sistemas informáticos de facturación (RRSIF).
- Orden HAC/1177/2024, especificaciones técnicas, funcionales y de contenido.
- Real Decreto 1619/2012, Reglamento de obligaciones de facturación.
- Real Decreto-ley 15/2025, que modificó los plazos de adaptación.
- Portal técnico, XSD, WSDL, validaciones, algoritmo de huella, QR, FAQ y ejemplos publicados por AEAT.

Portal de referencia: https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html

El registro operativo de fuentes revisadas está versionado en `config/regulatory-sources.json`. Su fecha debe coincidir con `AEAT_ARTIFACTS.verifiedAt` y el gate de release obliga a revalidarlo cuando supera la antigüedad máxima configurada.

## Plazos vigentes revisados el 2026-09-15

- Contribuyentes del Impuesto sobre Sociedades: sistemas adaptados antes del **1 de enero de 2027**.
- Resto de obligados incluidos en el art. 3.1 RRSIF: antes del **1 de julio de 2027**.

Estos plazos son datos regulatorios y no constantes de producto: deben verificarse de nuevo antes de publicar una versión candidata.

## Decisión del MVP

Puente VeriFactu operará inicialmente **exclusivamente en modalidad VERI*FACTU**. En esta modalidad los registros se remiten a AEAT tras su producción. El modo NO VERI*FACTU exige obligaciones adicionales, entre ellas firma de registros, registro de eventos y controles locales adicionales; no se mezclará de forma parcial con el MVP.

## Invariantes fiscales de ingeniería

- Cada factura emitida que entre en alcance produce el registro correspondiente.
- Los registros finalizados no se editan.
- Una corrección se representa con nuevos registros conforme a la semántica AEAT vigente.
- Todos los registros de facturación de alta y anulación calculan huella y participan en el encadenamiento según especificación.
- El QR y, en modalidad VERI*FACTU, la frase aplicable deben generarse conforme a la documentación vigente.
- El modelo distingue factura de registro de facturación: no son el mismo objeto.
- Los identificadores, series, fechas, importes y NIF se preservan con precisión y trazabilidad.
- No se considera una remisión exitosa hasta interpretar la respuesta AEAT.

## Declaración responsable

La normativa no define un registro previo general del producto ante AEAT. El productor del SIF debe certificar el cumplimiento mediante **declaración responsable para cada versión aplicable**, disponible para el usuario según las reglas vigentes. Puente VeriFactu prepara desde el desarrollo los datos y evidencias necesarios, pero no deberá publicarse como “certificado por AEAT”.

`docs/release/declaracion-responsable-template.md` es únicamente un checklist interno de datos y evidencias. No es una declaración firmada ni debe distribuirse como tal. La declaración definitiva se prepara y aprueba para la versión candidata exacta una vez cerrados sus blockers.

## Evidencia regulatoria de release

`npm run release:evidence:check` protege el contrato interno de release y forma parte de `npm run check`.

El gate exige:

- correspondencia exacta entre el registro regulatorio y las versiones `AEAT_ARTIFACTS` del adaptador;
- revisión regulatoria no caducada; por defecto el registro actual vence a los 90 días;
- SHA-256 reproducible de los paquetes WooCommerce y PrestaShop;
- commit fuente explícito para cada evidencia generada;
- blocker externo AEAT #6 representado mientras siga abierto;
- estado `release_blocked` mientras exista cualquier blocker de release/piloto.

El generador `npm run release:evidence` no sustituye la prueba externa ni la declaración responsable. Solo consolida evidencia técnica y regulatoria de un estado concreto de código.

## Exclusiones y detección

Antes de activar una organización, el onboarding debe determinar si entra en ámbito, incluyendo posibles exclusiones como SII u otros supuestos. El software puede asistir, pero la clasificación fiscal final requiere responsabilidad del cliente/asesor.

## Checklist de release regulatorio

Antes de marcar una versión como apta para producción:

1. Revisar BOE y portal AEAT por cambios posteriores a la última fecha documentada.
2. Descargar/contrastar WSDL, XSD, diseños de registro y validaciones vigentes.
3. Actualizar `config/regulatory-sources.json`, `AEAT_ARTIFACTS`, fixtures y contract tests si corresponde.
4. Ejecutar pruebas contra portal de pruebas externo y cerrar AEAT #6 con evidencia no sensible.
5. Verificar algoritmo de huella y encadenamiento con vectores conocidos.
6. Verificar alta, anulación, subsanación, rechazo, reconciliación y reintento.
7. Verificar QR y textos de factura.
8. Ejecutar CI completo sobre el commit candidato.
9. Generar evidencia de release para ese mismo commit y archivar sus fingerprints.
10. Preparar y aprobar la declaración responsable definitiva de esa versión.

## Política de cambios normativos

Un cambio oficial que afecte formatos, validaciones o semántica bloquea releases funcionales incompatibles hasta actualizar contratos, tests, documentación, evidencia de release y declaración responsable.
