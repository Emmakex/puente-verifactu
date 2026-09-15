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

## Plazos vigentes revisados el 2026-09-15

- Contribuyentes del Impuesto sobre Sociedades: sistemas adaptados antes del **1 de enero de 2027**.
- Resto de obligados incluidos en el art. 3.1 RRSIF: antes del **1 de julio de 2027**.

Estos plazos son datos regulatorios y no constantes de producto: deben verificarse de nuevo antes de publicar una versión certificable.

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

La normativa no define un registro previo general del producto ante AEAT. El productor del SIF debe certificar el cumplimiento mediante **declaración responsable** para cada versión aplicable, visible y conservada según la norma. Puente VeriFactu debe preparar desde el desarrollo los datos y evidencias necesarios para emitirla, pero no deberá publicarse como “certificado por AEAT”.

## Exclusiones y detección

Antes de activar una organización, el onboarding debe determinar si entra en ámbito, incluyendo posibles exclusiones como SII u otros supuestos. El software puede asistir, pero la clasificación fiscal final requiere responsabilidad del cliente/asesor.

## Checklist de release regulatorio

Antes de marcar una versión como apta para producción:

1. Revisar BOE y portal AEAT por cambios posteriores a la última fecha documentada.
2. Descargar/contrastar WSDL, XSD, diseños de registro y validaciones vigentes.
3. Actualizar fixtures oficiales y contract tests.
4. Ejecutar pruebas contra portal de pruebas externo.
5. Verificar algoritmo de huella y encadenamiento con vectores conocidos.
6. Verificar alta, anulación, subsanación, rechazo y reintento.
7. Verificar QR y textos de factura.
8. Revisar datos de la declaración responsable de esa versión.
9. Archivar evidencias de CI, test y revisión.

## Política de cambios normativos

Un cambio oficial que afecte formatos, validaciones o semántica bloquea releases funcionales incompatibles hasta actualizar contratos, tests, documentación y declaración responsable.
