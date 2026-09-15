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

**Nunca convertir automáticamente un resultado incierto en una nueva remisión.** La ausencia de respuesta no demuestra que AEAT no haya recibido la operación. Del mismo modo, un `SinDatos` devuelto por `ConsultaFactuSistemaFacturacion` significa solo que esa consulta no localizó el registro; no demuestra que reenviar sea seguro.

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

## Resultado incierto — consulta oficial

Si una operación está en `reconciliation_required`:

1. Congelar cualquier intento automático de reenvío para esa operación.
2. Localizar la base SQLite del deployment y el ID interno del job únicamente dentro del entorno seguro. No publicar ninguno de los dos.
3. Provisionar el PFX localmente o como secret/volumen montado, igual que en el gate AEAT:

```bash
export AEAT_TEST_PFX_PATH='/run/secrets/aeat-test.pfx'
export AEAT_TEST_PFX_PASSPHRASE_FILE='/run/secrets/aeat-test.passphrase'
```

4. Ejecutar primero el preflight local del certificado:

```bash
npm run aeat:cert:check
```

5. Ejecutar la reconciliación **read-only**. No cambia el estado del job:

```bash
npm run aeat:reconcile -- \
  --db /ruta/segura/runtime.sqlite \
  --job-id '<job-id>' \
  --source-commit '<SHA40>' \
  --evidence-output ./private-evidence/reconciliation-inspect.json
```

El comando usa `ConsultaFactuSistemaFacturacion` contra el entorno oficial de pruebas y compara NIF, número fiscal, fecha, `RefExterna` y huella. La salida pública/evidencia no incluye esos valores, el ID del job, la ruta SQLite, certificado, passphrase, XML ni SOAP crudo.

6. Interpretar el resultado:
   - `allReceived: true` → AEAT devolvió una coincidencia exacta para todas las entradas; todavía no se ha modificado SQLite en modo inspect;
   - `not_found`, `mismatch`, `ambiguous` o `query_error` → mantener `reconciliation_required` y escalar/investigar; **no reenviar**;
   - `SinDatos` nunca se clasifica como autorización de retry.
7. Si y solo si la inspección exacta ha sido revisada y se desea persistir el cierre local, ejecutar con doble guard:

```bash
export AEAT_RECONCILIATION_APPLY=YES
npm run aeat:reconcile -- \
  --db /ruta/segura/runtime.sqlite \
  --job-id '<job-id>' \
  --apply \
  --source-commit '<SHA40>' \
  --evidence-output ./private-evidence/reconciliation-applied.json
```

`--apply` puede realizar únicamente `reconciliation_required -> completed` cuando la nueva consulta oficial vuelve a confirmar todas las coincidencias exactas. Si la consulta deja de ser concluyente, el job permanece en cuarentena.

La evidencia se crea con permisos `0600` y no se sobrescribe. Guardarla fuera de Git y adjuntar al expediente operativo únicamente el hash/referencia que corresponda.

## ¿Cuándo podría existir un retry manual?

El CLI `aeat:reconcile` **no autoriza ni ejecuta retries**. Un eventual `reconciliation_required -> pending` pertenece a una decisión operativa separada y requiere evidencia positiva independiente de que una nueva remisión es segura. `SinDatos`, timeout de consulta, error SOAP, mismatch o ausencia de respuesta nunca constituyen esa evidencia.

## `blocked`

Una operación `blocked` no se reintenta automáticamente. Resolver la causa técnica/fiscal, volver a ejecutar preflight cuando corresponda y mantener la relación con el registro original. Nunca transformar un rechazo en un alta independiente para “hacer que pase”.

## Después de la recuperación

Volver a consultar `/v1/ops/status` y comprobar:

- no hay leases expirados inesperados;
- la edad del pending vuelve a niveles normales;
- `reconciliation_required` solo contiene casos todavía investigados;
- no se generaron duplicados ni nuevas claves de idempotencia para la misma operación.

## Gate actual

Mientras el gate externo AEAT #6 siga abierto, este procedimiento sirve para la prueba controlada y define la operación futura, pero no autoriza por sí mismo un piloto fiscal real. Para cerrar #6 debe conservarse evidencia sanitizada de remisión aceptada, rechazo controlado y reconciliación oficial real correspondientes al mismo candidato de release.
