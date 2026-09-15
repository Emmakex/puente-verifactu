# ADR-0001 — MVP solo VERI*FACTU

- Estado: Accepted
- Fecha: 2026-09-15

## Contexto

RRSIF admite modalidad VERI*FACTU y modalidad NO VERI*FACTU. Ambas comparten parte del modelo, pero NO VERI*FACTU incorpora obligaciones adicionales de seguridad, firma, eventos, comprobación y conservación.

## Decisión

La primera versión de Puente VeriFactu funcionará **siempre y exclusivamente en modalidad VERI*FACTU**. No existirá un switch oculto ni degradación automática a NO VERI*FACTU.

## Consecuencias positivas

- menor superficie regulatoria y de seguridad;
- comportamiento más uniforme entre conectores;
- los registros se remiten a AEAT tras producirse;
- reduce riesgo de implementar parcialmente requisitos NO VERI*FACTU;
- facilita una declaración responsable clara para el producto cuando corresponda.

## Costes

- requiere conectividad y estrategia robusta de cola/reintento;
- no satisface clientes que exijan operar en NO VERI*FACTU;
- si se añade modo dual deberá tratarse como proyecto y ADR independientes.

## Regla

Cualquier propuesta futura de modo NO VERI*FACTU debe incluir análisis regulatorio actualizado, threat model, almacenamiento/event log, firma, comprobación de huellas, migraciones y suite de conformidad específica antes de escribir código productivo.
