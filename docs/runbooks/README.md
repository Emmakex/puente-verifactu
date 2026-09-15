# Runbooks operativos — perfil single-node

Estos runbooks cubren el perfil soportado actualmente: una instancia de Puente VeriFactu con SQLite durable detrás de HTTPS. No convierten SQLite en HA y no habilitan por sí solos envío fiscal real.

## Regla de seguridad

1. Nunca reenviar una operación con resultado remoto incierto solo porque hubo timeout, caída de proceso o error de transporte.
2. `reconciliation_required` exige reconciliación explícita antes de cualquier nuevo intento.
3. Nunca restaurar una base de datos sobre una instancia en ejecución.
4. Antes de un cambio destructivo, crear y verificar un backup.
5. No copiar certificados, claves privadas, tokens, NIF, XML fiscales ni payloads completos en tickets, chats o logs.
6. El gate externo AEAT #6 sigue bloqueando release y piloto fiscal real.

## Orden de actuación ante incidente

1. Confirmar `/healthz` y `/readyz`.
2. Consultar `GET /v1/ops/status` con una credencial separada que tenga `ops:read`.
3. Si hay `critical`, detener cambios no esenciales y clasificar el incidente.
4. Si aparece `reconciliation_required`, aplicar el runbook AEAT; no reemitir.
5. Si la base está dañada o no abre, aplicar backup/restore con el proceso detenido.
6. Tras recuperación, ejecutar verificación post-deploy antes de reabrir tráfico.

## Runbooks

- `deploy-rollback.md` — despliegue, verificación y rollback seguro.
- `aeat-incident-reconciliation.md` — indisponibilidad AEAT y resultados inciertos.
- `backup-restore.md` — backup, verificación, restore y reconciliación posterior.
- `credential-rotation.md` — rotación de Bearer/Basic y credencial `ops:read`.

## Señales operativas

Los códigos `VF_OBS_*` de `GET /v1/ops/status` son la referencia para alertas. El endpoint no expone payload fiscal ni IDs de jobs. Para diagnóstico detallado se debe usar evidencia local segura y mínima.
