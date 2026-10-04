# Runbooks operativos — Kairoseth productivo + standalone

El perfil productivo actual es `kairoseth-hostinger-mongodb`: una instancia de aplicación Kairoseth en Hostinger con persistencia MongoDB inyectada, autoridad fiscal server-side y backup gestionado por la infraestructura.

SQLite permanece como perfil `standalone` para desarrollo, test y despliegues técnicos independientes. Sus procedimientos no acreditan el backup ni el rollback del candidato productivo Kairoseth.

## Regla de seguridad

1. Nunca reenviar una operación con resultado remoto incierto solo porque hubo timeout, caída de proceso o error de transporte.
2. `reconciliation_required` exige reconciliación explícita antes de cualquier nuevo intento.
3. Un rollback de código Kairoseth no restaura MongoDB automáticamente.
4. Un restore de datos solo procede con daño confirmado, evidencia y aprobación operativa.
5. No copiar certificados, claves privadas, tokens, credenciales MongoDB, NIF, XML fiscales ni payloads completos en tickets, chats o logs.
6. El gate externo AEAT #6 está cerrado; cualquier piloto fiscal real sigue requiriendo candidato exacto, declaración aprobada, backup/restore drill real, observabilidad limpia y `pilot:readiness`.

## Orden de actuación ante incidente

1. Confirmar `/healthz` y `/readyz`.
2. Consultar `GET /v1/ops/status` con una credencial separada `ops:read`.
3. Confirmar `mode=kairoseth-mongodb` en el deployment productivo.
4. Si hay `critical`, detener cambios no esenciales y clasificar el incidente.
5. Si aparece `reconciliation_required`, aplicar el runbook AEAT; no reemitir.
6. Si hay daño confirmado de datos, seguir el procedimiento gestionado MongoDB; no usar restore SQLite sobre Kairoseth.
7. Tras recuperación, ejecutar verificación post-deploy antes de reabrir tráfico.

## Runbooks

- `deploy-rollback.md` — despliegue y rollback del perfil productivo Kairoseth.
- `aeat-incident-reconciliation.md` — indisponibilidad AEAT y resultados inciertos.
- `backup-restore.md` — backup/restore del perfil SQLite `standalone`.
- `credential-rotation.md` — rotación de Bearer/Basic y credencial `ops:read`.
- `pilot-progressive.md` — aprobación privada, evidencia del entorno, stop conditions y apertura controlada del piloto.

Contrato de backup productivo: `docs/kairoseth-backup-evidence.md`.

## Señales operativas

Los códigos `VF_OBS_*` de `GET /v1/ops/status` son la referencia para alertas. El endpoint no expone payload fiscal ni IDs de jobs. Para diagnóstico detallado se debe usar evidencia local segura y mínima.
