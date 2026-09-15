# Security Policy

No publiques vulnerabilidades, certificados, claves, tokens, NIF/datos personales de clientes ni payloads fiscales reales en issues públicos.

Para incidencias de seguridad, utiliza un canal privado del mantenedor antes de abrir detalles públicos. Mientras no exista un canal dedicado publicado, contacta al propietario del repositorio mediante un canal privado ya establecido.

## Alcance prioritario

- bypass de autenticación/autorización;
- acceso cross-tenant;
- exposición de certificados o secretos;
- modificación/duplicación de registros fiscales;
- vulnerabilidades de firma/hash/encadenamiento;
- SSRF/XML injection;
- replay/idempotencia;
- falsificación de webhooks.

Toda corrección de seguridad debe incorporar prueba de regresión y revisión de impacto histórico cuando aplique.
