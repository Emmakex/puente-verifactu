# Evidencia sanitizada — AEAT gate #6

Fecha de ejecución: **2026-10-03**

Commit candidato sometido a la prueba externa:

```text
1b1f4facef23bba98b67e0041e7143b0c2224baa
```

## Resultado

El gate externo definido en el issue #6 se ejecutó contra el entorno oficial de pruebas de AEAT usando un certificado válido provisionado fuera del repositorio.

Resultado final del verificador:

```text
status: external_gate_evidence_complete
remainingExternalEvidence: []
releaseUnblocked: false
automaticIssueClosure: false
```

La ejecución incluyó:

- remisión real aceptada por AEAT: `accepted`;
- CSV de respuesta presente y fingerprint conservado;
- `TiempoEsperaEnvio=60`;
- rechazo controlado determinista `future-issue-date`: `rejected`, código normalizado `1112`;
- reconciliación mediante `ConsultaFactuSistemaFacturacion` con coincidencia exacta;
- `allReceived=true`, `shouldReissue=false`;
- aplicación controlada `reconciliation_required -> completed`, `applied=true`;
- binding criptográfico entre el registro aceptado y la reconciliación;
- evidencia final sanitizada y ligada al mismo commit.

## Artefactos AEAT fijados

- WSDL: `1.0.3`
- documento de validaciones: `1.2.2`
- generación de esquema: `tikeV1.0`
- versión de registro: `1.0`

## Fingerprints no sensibles

- accepted XML SHA-256: `5975af38c0b84989640909a8307285d70347c1d2ab234d3c6f1746f6484b9bcc`
- accepted CSV SHA-256: `333940cfa22b3864741520b9ddf64e4f3ada1be2f4281e4ca2f5b586dab1afd9`
- rejected XML SHA-256: `a62da23a0706f0b2f529689ec508a1bbfa33b1b8b7736e7a86be19ef0859addf`
- reconciled record hash fingerprint: `287a3bf8b9a149a2cdfc11f20e9be60170db421a5918d877697d2d43082d6a6d`
- reconciliation job fingerprint: `f27000436c2b4e82999f5310a6928fc971344a58695fd7fe71e873bce3daa73e`

## Validación del candidato

- CI post-merge #158: `success`, 8/8.
- Validación local final con Node 22:
  - `npm run check`: OK;
  - `npm test`: **185 tests, 185 pass, 0 fail**.

## Privacidad

Este documento no contiene PFX, clave privada, passphrase, NIF, XML/SOAP/CSV crudos, rutas locales privadas ni job IDs. Los artefactos privados de operación permanecen fuera del repositorio.

## Alcance

Esta evidencia satisface el gate externo #6. No equivale por sí sola a una autorización de publicación o producción. La declaración responsable de la versión y el resto de gates de Fase 6 continúan siendo requisitos separados.
