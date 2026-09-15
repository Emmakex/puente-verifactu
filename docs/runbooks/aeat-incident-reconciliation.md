# Runbook — incidente AEAT y `reconciliation_required`

## Objetivo

Evitar duplicados fiscales cuando una operación queda con resultado remoto incierto por timeout, caída de red, crash o lease vencido.

## Disparadores

Aplicar este runbook si `GET /v1/ops/status` muestra cualquiera de estas alertas:

- `VF_OBS_AEAT_RECONCILIATION_REQUIRED`;
- `VF_OBS_AEAT_LEASE_EXPIRED`;
- `VF_OBS_AEAT_OUTBOX_BLOCKED`;
- crecimiento sostenido de pending/processing con AEAT no disponible.

## Regla principal

**Nunca convertir automáticamente un resultado incierto en una nueva remisión.** La ausencia de respuesta no demuestra que AEAT no haya recibido la operación.

## Diagnóstico inicial

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $PV_OPS_TOKEN" \
  "$PV_PUBLIC_BASE_URL/v1/ops/status"
```

Registrar únicamente:

- código de alerta;
- timestamp UTC;
- versión/commit desplegado;
- contador afectado;
- referencia interna de incidente.

No pegar XML, certificados, tokens, NIF ni payloads completos en el ticket.

## AEAT no disponible pero sin resultado incierto

Si las operaciones siguen `pending` y no empezó un dispatch, mantenerlas en cola y esperar recuperación. No forzar un bypass del backoff ni crear otra operación con una idempotency key nueva.

## Resultado incierto

Si una operación está en `reconciliation_required`:

1. Congelar cualquier intento automático de reenvío para esa operación.
2. Localizar evidencia de la remisión original en el entorno seguro: timestamps, fingerprint/hash, respuesta parcial si existe y correlación local.
3. Consultar el resultado remoto por el mecanismo oficial disponible para el entorno AEAT aplicable.
4. Clasificar el caso:
   - **confirmado recibido/aceptado o rechazado por AEAT** → cerrar localmente sin nueva remisión;
   - **confirmado no recibido** → puede autorizarse un nuevo intento reutilizando la misma identidad/idempotencia;
   - **no se puede determinar** → mantener `reconciliation_required` y escalar; no reenviar.
5. Conservar evidencia mínima no sensible de la decisión y su responsable operativo.

## `blocked`

Una operación `blocked` no se reintenta automáticamente. Resolver la causa técnica/fiscal, volver a ejecutar preflight cuando corresponda y mantener la relación con el registro original. Nunca transformar un rechazo en un alta independiente para “hacer que pase”.

## Después de la recuperación

Volver a consultar `/v1/ops/status` y comprobar:

- no hay leases expirados inesperados;
- la edad del pending vuelve a niveles normales;
- `reconciliation_required` solo contiene casos todavía investigados;
- no se generaron duplicados ni nuevas claves de idempotencia para la misma operación.

## Gate actual

Mientras el gate externo AEAT #6 siga abierto, este procedimiento sirve para pruebas técnicas y define la operación futura, pero no autoriza por sí mismo un piloto fiscal real.
