# Piloto progresivo v1

Este gate prepara el piloto fiscal real del perfil `kairoseth-hostinger-mongodb`. No activa envíos ni aprueba nada automáticamente.

## Principio

Un candidato solo puede obtener `pilot_ready` cuando coinciden, para el mismo commit:

- bundle final `candidate_evidence_complete`;
- aprobación humana privada que referencia exactamente la huella de la declaración revisada;
- snapshot operacional completamente `ok`;
- cero `reconciliation_required`, cero `blocked` y cero leases expirados;
- monitorización de backup configurada y en estado `ok`;
- evidencia gestionada MongoDB en `ok`, cifrada en reposo, con backup reciente y restore drill reciente;
- política de piloto con stop conditions obligatorias.

La aprobación privada no es una firma electrónica de la declaración ni sustituye la responsabilidad del productor. Es una guarda operativa que impide iniciar el piloto por accidente.

## Política inicial

Campos obligatorios de la política: `stop_on_warning=true`, `stop_on_rejection=true`, `stop_on_reconciliation_required=true`, `stop_on_blocked=true` y `rollback_mode=code-first-no-automatic-db-restore`.


`config/pilot-policy.example.json` propone una primera ventana conservadora de hasta 5 operaciones o 120 minutos, backup de antigüedad máxima 26 horas y restore drill de antigüedad máxima 90 días. Son límites internos de ingeniería, no límites establecidos por AEAT.

Cualquier warning, rechazo, reconciliación pendiente o bloqueo obliga a detener la ventana y revisar antes de continuar.

Rollback: **código primero, sin restore automático de MongoDB**. Un restore solo procede si hay daño confirmado, mediante el procedimiento gestionado de Kairoseth/proveedor y tras revisar el estado fiscal posterior al punto de recuperación.

## Preparación privada

Copiar `config/pilot-approval.example.json` fuera del repositorio y completar solo después de revisar/aprobar la declaración definitiva:

```bash
mkdir -p "$HOME/.puente-verifactu/pilot"
chmod 700 "$HOME/.puente-verifactu/pilot"
cp config/pilot-approval.example.json "$HOME/.puente-verifactu/pilot/approval-v0.1.0.json"
chmod 600 "$HOME/.puente-verifactu/pilot/approval-v0.1.0.json"
```

No subir ese fichero a Git.

## Captura de estado operacional

Guardar el snapshot autenticado sin imprimir el token:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $PV_OPS_TOKEN" \
  "$PV_PUBLIC_BASE_URL/v1/ops/status" \
  > "$HOME/.puente-verifactu/pilot/ops-status.json"
chmod 600 "$HOME/.puente-verifactu/pilot/ops-status.json"
```

El deployment Kairoseth debe producir evidencia real y sanitizada de su backup
MongoDB gestionado. El contrato está en
`config/kairoseth-backup-evidence.example.json` y se documenta en
`docs/kairoseth-backup-evidence.md`.

Guardar el recibo real fuera de Git:

```bash
chmod 600 "$HOME/.puente-verifactu/pilot/backup-report.json"
```

El fichero debe provenir del procedimiento operativo de Kairoseth/proveedor y
acreditar `status=ok`, cifrado en reposo, timestamp del backup, referencia opaca
y restore drill correcto. No se considera evidencia válida copiar el ejemplo y
cambiar manualmente `status` a `ok`.

## Gate

```bash
npm run pilot:readiness -- \
  --bundle "$HOME/.puente-verifactu/evidence/final-release-bundle-v0.1.0-<sha>.json" \
  --approval "$HOME/.puente-verifactu/pilot/approval-v0.1.0.json" \
  --ops-status "$HOME/.puente-verifactu/pilot/ops-status.json" \
  --backup-report "$HOME/.puente-verifactu/pilot/backup-report.json" \
  --policy config/pilot-policy.example.json \
  --expected-commit "<SHA40>" \
  --output "$HOME/.puente-verifactu/pilot/readiness-v0.1.0.json"
```

Resultado correcto:

```text
status: pilot_ready
contains_personal_data: false
operational_readiness.ops_status: ok
operational_readiness.reconciliation_required: 0
operational_readiness.blocked: 0
```

Solo después de ese resultado se abre la ventana controlada. Durante la ventana se vigila `/v1/ops/status` y se detiene al primer stop condition.
