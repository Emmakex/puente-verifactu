# Evidencia sanitizada — distribución controlada v0.1.0

## Fuente exacta

- Candidato: `fe4c6360a2b25d44f5044e202f7d2bc2faa626a7`.
- CI exacto candidato: run `37224109793` / #335.
- Resultado global: `success`.

## WooCommerce

El CI exacto instaló el ZIP reproducible y ejecutó smoke real en tres combinaciones:

- WordPress 6.5 / WooCommerce 8.2.0 / PHP 7.4 — success.
- WordPress 7.0.4 / WooCommerce 11.0.1 / PHP 8.2 — success.
- WordPress 7.1 / WooCommerce 11.1.0 / PHP 8.3 — success.

Cada job completó `Build reproducible plugin package` y `Install and smoke-test real WordPress + WooCommerce`.

Artefacto validado: WooCommerce 0.3.0, SHA-256 `f034e1f6866f331fa7ce11983a751a0f6c4c15397d4793b10b2226edc96eba1f`.

## PrestaShop

El CI exacto instaló el ZIP reproducible y construyó payload real de factura en:

- PrestaShop 1.7.8.11 / PHP 7.4 — success.
- PrestaShop 8.1.7 / PHP 8.1 — success.
- PrestaShop 8.2.7 / PHP 8.1 — success.

También pasó el smoke de upgrade en PrestaShop 8.2.7 / PHP 8.1 preservando estado local.

Artefacto validado: PrestaShop 0.5.0, SHA-256 `c734cc3b73e495de5538b6ee43f17ef36a3debbb1efd988704af784af96098eb`.

## Local Agent

El CI exacto construyó el bundle portable desde el SHA exacto, lo publicó como artefacto interno del workflow y ejecutó instalación/smoke nativo en:

- Linux x64 — success;
- Windows x64 — success;
- macOS Intel x64 — success;
- macOS ARM64 — success.

En las cuatro plataformas pasaron `status + doctor`; además pasaron lifecycle de servicio y upgrade + rollback code-only en la plataforma correspondiente.

Compatibilidad read-only adicional validada:

- PostgreSQL 16 — success;
- MySQL 8.4 — success;
- MariaDB 11.4 — success;
- SQL Server 2022 — success;
- SFTP / OpenSSH read-only — success.

Artefacto validado: Local Agent 0.1.0, SHA-256 `d9c415dead492bf7cfec12e12b29561b88f9cda2802df638bbb8bec23c101f21`.

## API universal y onboarding

En el mismo candidato pasaron:

- repository contract check;
- unit/contract tests;
- zero-code CSV preflight smoke;
- assisted mapping smoke;
- zero-code onboarding smoke;
- third-party connector contract;
- native connector reconciliation contract v2;
- durable HTTP runtime smoke;
- observabilidad;
- API lifecycle v1;
- starter kits HTTP/JSON.

## Kairoseth runtime

El job `Kairoseth / Hostinger / MongoDB registry` terminó en success, incluyendo verificación de arquitectura y smoke real del registry MongoDB.

El piloto posterior sobre el deployment Kairoseth cerró con 5/5 operaciones aceptadas por AEAT TEST y snapshot final `status=ok`, sin duplicados, bloqueos ni reconciliaciones pendientes.

## Resultado

`distribution_smoke = passed`

La evidencia demuestra instalabilidad y ejecución controlada de los canales soportados sobre el candidato exacto. No demuestra ni habilita AEAT producción.

## Exclusiones de seguridad

Este documento no contiene PFX, passphrases, NIF, XML/SOAP crudo, credenciales MongoDB, tokens ni payloads fiscales.