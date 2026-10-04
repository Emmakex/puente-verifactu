# Runbooks operativos — Kairoseth productivo + standalone

El perfil candidato v0.1.0 es `kairoseth-hostinger-mongodb`: una instancia de aplicación Kairoseth sobre Hostinger con persistencia productiva MongoDB inyectada. Los procedimientos SQLite se conservan únicamente para `standalone`, desarrollo/test y recuperación de ese perfil de referencia. Ningún runbook habilita por sí solo envío fiscal real.

## Regla de seguridad

1. Nunca reenviar una operación con resultado remoto incierto solo porque hubo timeout, caída de proceso o error de transporte.
2. `reconciliation_required` exige reconciliación explícita antes de cualquier nuevo intento.
3. Nunca restaurar MongoDB o SQLite sobre una instancia activa sin el procedimiento específico del perfil.
4. Antes de un cambio destructivo, exigir evidencia de backup/restore válida para el perfil seleccionado.
5. No copiar certificados, claves privadas, tokens, NIF, XML fiscales ni payloads completos en tickets, chats o logs.
6. El gate externo AEAT #6 está cerrado; cualquier piloto fiscal real sigue requiriendo el candidato exacto, declaración aprobada, backup real, observabilidad limpia y el gate de readiness.

## Orden de actuación ante incidente

1. Confirmar `/healthz` y `/readyz`.
2. Consultar `GET /v1/ops/status` con una credencial separada que tenga `ops:read`.
3. Si hay `critical`, detener cambios no esenciales y clasificar el incidente.
4. Si aparece `reconciliation_required`, aplicar el runbook AEAT; no reemitir.
5. Si la persistencia está dañada, aplicar el procedimiento gestionado MongoDB de Kairoseth; usar `backup-restore.md` solo para SQLite standalone.
6. Tras recuperación, ejecutar verificación post-deploy antes de reabrir tráfico.

## Runbooks

- `deploy-rollback.md` — despliegue, verificación y rollback seguro.
- `aeat-incident-reconciliation.md` — indisponibilidad AEAT y resultados inciertos.
- `backup-restore.md` — backup/restore SQLite standalone.
- `../kairoseth-backup-evidence.md` — contrato de evidencia de backup/restore gestionado MongoDB para el candidato Kairoseth.
- `credential-rotation.md` — rotación de Bearer/Basic y credencial `ops:read`.
- `pilot-progressive.md` — aprobación privada, evidencia del entorno, stop conditions y apertura controlada del piloto.

## Señales operativas

Los códigos `VF_OBS_*` de `GET /v1/ops/status` son la referencia para alertas. El endpoint no expone payload fiscal ni IDs de jobs. Para diagnóstico detallado se debe usar evidencia local segura y mínima.
