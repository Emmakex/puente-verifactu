# Changelog

Todos los cambios relevantes se documentarán aquí siguiendo un formato compatible con Keep a Changelog y versionado semántico cuando comiencen las releases.

## [Unreleased]

### Added

- Harness seguro `npm run aeat:gate` para dry-run y cierre del gate real de pruebas AEAT con doble confirmación de envío y salida sanitizada.
- Adaptador server-side AEAT VERI*FACTU con SOAP 1.1/XML y endpoints oficiales versionados.
- Transporte HTTPS mTLS con guard de producción y credenciales cargadas en runtime.
- Normalización de respuestas, `AceptadoConErrores`, rechazos, duplicados y SOAP Faults.
- Protección DTD/XXE para XML recibido.
- Control de flujo mediante `TiempoEsperaEnvio` y outbox/reintentos técnicos de referencia.
- Recargo de equivalencia a nivel de línea en `InvoiceIntent v1`, mapping, validación, cuota total y XML AEAT.
- Tests contractuales del adaptador sin certificados ni secretos.
- Registros fiscales internos de alta y anulación.
- Huella AEAT SHA-256 (`TipoHuella=01`) con material exacto y salida hexadecimal en mayúsculas.
- Fixtures oficiales AEAT para primer alta, alta encadenada y anulación encadenada.
- Cadena única por obligado + SIF + instalación, con serialización de concurrencia.
- Idempotencia de fiscalización y verificación de registros/cadenas.
- Generación de timestamp con zona IANA y offset explícito.
- `InvoiceIntent v1` y JSON Schema versionado.
- `MappingProfile v1`, transforms limitados e inferencia de cabeceras ES/EN.
- Preflight CSV sin efectos con reporte por fila.
- Aritmética monetaria exacta para el contrato v1.
- Idempotencia determinista, huella canónica y store append-only de referencia.
- Máquina de estados y validación bilingüe ES/EN.
- Fixtures CSV y smoke test cero-código en CI.
- Foundation técnica con Node.js 22 y gate CI sin dependencias.
- Principio Camaleón con cinco niveles de integración.
- ADR-0002 para integración universal.
- Onboarding por capacidades y concepto versionado `MappingProfile`.
- Estructura inicial de API, contracts, core, diagnostics y conectores.
- Documentación inicial de producto, arquitectura, cumplimiento, seguridad, testing, operación y roadmap.
- ADR-0001: primera versión solo VERI*FACTU.
