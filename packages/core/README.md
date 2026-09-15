# Core

Núcleo independiente de plataforma.

Fase 1 implementó validación canónica, decimal exacto, mapping/preflight, idempotencia, máquina de estados y persistencia append-only lógica de referencia.

Fase 2 añade:

- construcción de registros internos de alta y anulación;
- material de huella AEAT y SHA-256 (`TipoHuella=01`);
- encadenamiento único por obligado + SIF + instalación;
- timestamps con zona IANA y offset explícito;
- idempotencia de fiscalización;
- serialización de concurrencia por cadena;
- verificación de registro/cadena;
- fixtures oficiales AEAT como regresión.

La persistencia en memoria es una referencia ejecutable y no es apta para producción. XML AEAT, certificados y transporte pertenecen a fases posteriores.
