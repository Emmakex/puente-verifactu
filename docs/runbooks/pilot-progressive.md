# Piloto progresivo v1

Este gate prepara el piloto fiscal real del perfil productivo `kairoseth-hostinger-mongodb`. No activa envíos ni aprueba nada automáticamente.

## Principio

Un candidato solo puede obtener `pilot_ready` cuando coinciden, para el mismo commit:

- bundle final `candidate_evidence_complete`;
- aprobación humana privada que referencia exactamente la huella de la declaración revisada;
- snapshot operacional completamente `ok` y con `mode=kairoseth-mongodb`;
- cero `reconciliation_required`, cero `blocked` y cero leases expirados;
- monitorización de backup Kairoseth configurada y en estado `ok`;
- evidencia gestionada de backup remoto cifrado, reciente y con restore drill satisfactorio;
- política de piloto con stop conditions obligatorias.

La aprobación privada no es una firma electrónica de la declaración ni sustituye la responsabilidad del productor. Es una guarda operativa que impide iniciar el piloto por accidente.

## Política inicial

Campos obligatorios de la política: `deployment_profile=kairoseth-hostinger-mongodb`, `backup_evidence_kind=kairoseth-managed-backup-readiness`, `stop_on_warning=true`, `stop_on_rejection=true`, `stop_on_reconciliation_required=true`, `stop_on_blocked=true` y `rollback_mode=code-first-no-automatic-db-restore`.

`config/pilot-policy.example.json` propone una primera ventana conservadora de hasta 5 operaciones o 120 minutos, backup con antigüedad máxima de 26 horas y restore drill con antigüedad máxima de 90 días. Son límites internos de ingeniería, no límites establecidos por AEAT.

Cualquier warning, rechazo, reconciliación pendiente o bloqueo obliga a detener la ventana y revisar antes de continuar.

Rollback: **código primero, sin restore automático de la base**. Un restore solo procede si hay daño confirmado y siguiendo el runbook específico.

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

### Evidencia de backup Kairoseth

El piloto productivo **no usa el lifecycle SQLite**. El deployment Kairoseth debe preparar fuera del repositorio un informe sanitizado basado en evidencia real del backup MongoDB gestionado, con `kind=kairoseth-managed-backup-readiness`.

Se puede partir de `config/kairoseth-backup-readiness.example.json` y guardarlo fuera de Git:

```bash
cp config/kairoseth-backup-readiness.example.json \
  "$HOME/.puente-verifactu/pilot/backup-report.json"
chmod 600 "$HOME/.puente-verifactu/pilot/backup-report.json"
```

Antes de ejecutar el gate deben sustituirse los placeholders con evidencia real. El informe debe acreditar:

- `deploymentProfile=kairoseth-hostinger-mongodb`;
- backup remoto;
- cifrado en reposo;
- timestamp del backup;
- fingerprint SHA-256 del artefacto o manifest sanitizado que identifica ese backup;
- restore drill satisfactorio sobre ese mismo fingerprint;
- ausencia de secretos y datos fiscales en el informe compartido;
- `provider` como referencia descriptiva opaca/no secreta, nunca URL firmada ni valor con token.

El gate rechaza automáticamente backups demasiado antiguos, restore drills vencidos, fingerprints distintos, referencias de proveedor inseguras o un informe asociado a otro perfil/kind.

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
operational_readiness.persistence_mode: kairoseth-mongodb
operational_readiness.ops_status: ok
operational_readiness.reconciliation_required: 0
operational_readiness.blocked: 0
```

## Apertura de la ventana en Kairoseth Platform

Obtener `pilot_ready` no abre por sí solo la ventana. Antes de descubrir perfiles o ejecutar cualquier operación fiscal, Kairoseth Platform debe superar un **preflight autenticado y de solo lectura**.

La implementación operativa vive en Kairoseth Platform y usa:

```bash
node scripts/kairoseth-fiscal-pilot-control.mjs preflight
```

El comando requiere `OPERATIONS_HEALTH_SECRET` únicamente como variable de entorno privada local. No copiar ese secreto a Git, issues, logs, tickets o chat.

El preflight solo es válido si el runtime efectivo confirma simultáneamente:

```text
environment: test
pilotControlEnabled: true
productionAllowed: false
containsSecrets: false
containsFiscalData: false
```

Además:

- no requiere `organizationId` ni `profileId`;
- responde antes de inicializar el control plane;
- no consulta MongoDB;
- no lista IntegrationProfiles;
- no lee, crea, rota ni revoca credenciales;
- no ejecuta ninguna operación fiscal;
- falla cerrado si `PV_FISCAL_PILOT_CONTROL_ENABLED` no es `YES`;
- falla cerrado si `PV_AEAT_ENVIRONMENT` no es `test`;
- falla cerrado si `PV_AEAT_ALLOW_PRODUCTION=YES`.

Solo después de un preflight `ok` se continúa con esta secuencia común:

1. obtener el `organizationId` real desde el `pilot-context` autorizado de Kairoseth Platform; nunca inventarlo ni consultarlo directamente en MongoDB;
2. ejecutar `list` para descubrir IntegrationProfiles sanitizados;
3. seleccionar un `profileId` real y comprobar `channel`, `adapter`, `status` y `credentialApplicable`;
4. capturar backup gestionado, snapshot operacional y `pilot:readiness` frescos inmediatamente antes de la primera operación;
5. iniciar la operación **1/5** únicamente en AEAT test y detenerse al primer stop condition.

### Perfil con credencial data-plane

Solo los canales `native_plugin`, `rest_api` y `webhook` usan credencial bearer del IntegrationProfile.

Para esos canales:

1. ejecutar `provision` si `credentialConfigured=false`, o `rotate` de forma explícita si ya existe una credencial activa;
2. guardar el token one-shot fuera del repositorio con permisos `0600`, sin imprimirlo ni copiarlo a chat/logs;
3. capturar snapshot/readiness frescos antes de la operación 1/5.

### Perfil `manual/manual-capture`

El perfil manual **no usa credencial data-plane**. El estado correcto es:

```text
credentialApplicable: false
credentialConfigured: false
```

`credentialConfigured=false` no indica una credencial pendiente. `provision`, `rotate` y `revoke` no aplican a este canal; el motor falla cerrado con `VF_INTEGRATION_CREDENTIAL_NOT_APPLICABLE` si se intentan.

El flujo controlado de Kairoseth Platform es:

```text
preflight Kairoseth
  -> pilot-context
  -> list
  -> ensure-manual (solo si no existe)
  -> list y verificar credentialApplicable=false
  -> backup + snapshot + pilot:readiness frescos
  -> POST pilot-manual action=preflight
  -> revisión humana del preflight
  -> POST pilot-manual action=issue con confirmIssue=true
  -> operación 1/5
  -> snapshot + reconciliación
```

La ruta temporal de sesión es:

```text
POST /api/organizations/<slug>/products/puente-verifactu/pilot-manual
```

`action=preflight` es dry-run y no crea un registro fiscal ni encola AEAT. `action=issue` exige `confirmIssue=true`, repite el preflight server-side y solo continúa si permanece limpio. Kairoseth deriva `organizationId`, `installationId` y `sourceSystem` desde la sesión/workspace y el IntegrationProfile controlado; el cliente no puede fijarlos.

Si el preflight falla, la ventana **no se abre**. Si existe cualquier warning, rechazo AEAT, reconciliación requerida, bloqueo, lease expirado, pérdida de disponibilidad MongoDB/outbox o backup no `ok`, se detiene el piloto y se aplica la política de rollback/revisión.

## Durante y al cerrar la ventana

Solo después de `pilot_ready` y del preflight autenticado `ok` se abre la ventana controlada. Durante la ventana se vigila `/v1/ops/status` y se detiene al primer stop condition.

Al cerrar la ventana:

1. si el canal usado tiene `credentialApplicable=true`, revocar la credencial temporal del IntegrationProfile; para `manual`, no existe credencial que revocar;
2. confirmar snapshot operacional limpio;
3. volver a `PV_FISCAL_PILOT_CONTROL_ENABLED=NO`;
4. comprobar que el control temporal vuelve a fallar cerrado;
5. conservar en Git únicamente evidencia sanitizada.

El candidato fiscal permanece ligado al SHA aprobado; estas instrucciones operativas no cambian el candidato ni habilitan AEAT producción.
