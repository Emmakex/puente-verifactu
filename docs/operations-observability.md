# Operación, observabilidad y diagnóstico

## Correlación

Cada operación recibe `correlationId`, `organizationId`, `installationId`, `recordId` y, cuando exista, `sourceInvoiceId`. Los logs estructurados permiten seguir el recorrido completo sin exponer secretos.

Los identificadores de negocio pueden existir en logs internos sanitizados cuando sean estrictamente necesarios para diagnóstico, pero el endpoint operacional agregado **no expone** NIF, números de factura, payloads, IDs de jobs ni tenant IDs.

## Endpoints operativos

### Públicos y mínimos

- `GET /healthz`: confirma que el proceso HTTP está vivo.
- `GET /readyz`: confirma que la persistencia mínima del perfil activo responde (SQLite en `standalone`; healthcheck MongoDB en `kairoseth`).

Ambos endpoints permanecen deliberadamente mínimos y no revelan contadores ni estructura interna.

### Estado operacional autenticado

`GET /v1/ops/status` devuelve un snapshot agregado del perfil activo (`single-node-sqlite` o `kairoseth-mongodb`).

Requisitos:

- autenticación existente del runtime;
- permiso explícito `ops:read` en la credencial;
- respuesta `403 VF_OPS_FORBIDDEN` para una credencial válida sin dicho permiso;
- `Cache-Control: no-store`;
- sin payloads fiscales, datos personales, secretos, rutas locales ni IDs de operaciones.

Ejemplo de credencial operacional:

```json
{
  "id": "ops-monitor",
  "type": "bearer",
  "tokenSha256": "<64-hex>",
  "organizationId": "ops",
  "installationId": "runtime",
  "sourceSystem": "operations",
  "rateLimitPerMinute": 60,
  "permissions": ["ops:read"]
}
```

Las credenciales existentes sin `permissions` siguen siendo válidas y reciben una lista vacía de permisos.

## Snapshot operacional v1

El JSON incluye únicamente agregados:

- salud de la persistencia activa;
- outbox AEAT: total, `pending`, `processing`, `reconciliationRequired`, `completed`, `blocked`, pendientes ya vencidos y leases expirados;
- edad del job pendiente más antiguo;
- edad de la reconciliación pendiente más antigua;
- estado y antigüedad del manifest de backup configurado;
- alertas activas y resumen `ok|warning|critical`.

En `standalone`, el manifest de backup se configura con
`PV_BACKUP_MANIFEST_PATH`. En `kairoseth`, el runtime exige un
`backupStatusProvider` inyectado que reporta el estado del backup MongoDB
gestionado. En ambos casos, el estado observado no sustituye los ejercicios
periódicos de restore.

## Umbrales v1

Valores por defecto del perfil single-node:

- pendiente AEAT: warning a 5 min, critical a 15 min;
- backup: warning a 26 h, critical a 50 h.

Estos umbrales son contrato inicial conservador. Se pueden inyectar en `createPuenteRuntime()` para tests/despliegues especializados sin cambiar el formato del snapshot.

## Alertas estables

Códigos principales:

- `VF_OBS_DATABASE_UNAVAILABLE` — critical;
- `VF_OBS_AEAT_OUTBOX_UNAVAILABLE` — critical;
- `VF_OBS_AEAT_RECONCILIATION_REQUIRED` — critical;
- `VF_OBS_AEAT_OUTBOX_BLOCKED` — critical;
- `VF_OBS_AEAT_LEASE_EXPIRED` — critical;
- `VF_OBS_AEAT_PENDING_AGE_WARNING` — warning;
- `VF_OBS_AEAT_PENDING_AGE_CRITICAL` — critical;
- `VF_OBS_BACKUP_MONITORING_UNCONFIGURED` — warning;
- `VF_OBS_BACKUP_MANIFEST_INVALID` — critical;
- `VF_OBS_BACKUP_AGE_WARNING` — warning;
- `VF_OBS_BACKUP_AGE_CRITICAL` — critical.

Un snapshot sigue siendo generable ante fallo de persistencia: devuelve
`database.ok=false` y alertas críticas sanitizadas en vez de depender de un
500 opaco. En Kairoseth, outbox y healthcheck son async/MongoDB-aware.

## Métricas mínimas futuras

El snapshot v1 cubre el estado operacional durable disponible hoy. Los siguientes incrementos pueden añadir, sin romper el schema v1:

- registros recibidos/validados/fiscalizados;
- aceptados/rechazados por ventana temporal;
- latencia AEAT;
- reintentos por causa;
- errores de certificado;
- conflictos de idempotencia;
- fallos por versión de conector;
- bloqueos de cadena.

No se añade todavía una dependencia obligatoria de Prometheus, Datadog, Grafana Cloud u otro proveedor. El contrato JSON puede ser recogido por el sistema de monitorización elegido por cada despliegue.

## Reintentos

Solo respuestas inequívocamente clasificadas como transitorias pueden reintentarse automáticamente. Usar backoff con límite. Un resultado remoto incierto pasa a `reconciliation_required`; nunca se reemite de forma ciega.

## Dead-letter / blocked

Los mensajes que superen política de reintento pasan a `blocked` con diagnóstico accionable y procedimiento de recuperación. Nunca se descartan silenciosamente.

## Diagnóstico estructurado obligatorio

Todo fallo de CI, build, test, deploy o runtime debe poder resumirse con:

- pipeline/job/step o componente;
- comando/operación;
- código de salida/estado;
- mensaje principal;
- archivo/línea cuando exista;
- contexto mínimo;
- firma estable del error;
- causa raíz confirmada o hipótesis marcada;
- fix aplicado;
- validación ejecutada;
- referencia al PR/commit/incidente.

Formato conceptual:

```json
{
  "error_signature": "...",
  "component": "aeat-adapter",
  "operation": "submit-record",
  "primary_error": "...",
  "retryable": false,
  "root_cause_status": "confirmed|hypothesis|unknown",
  "correlation_id": "..."
}
```

## Runbooks

Antes de producción deben existir runbooks para: AEAT no disponible, certificado expirado, rechazo masivo tras cambio de esquema, cola atascada, `reconciliation_required`, despliegue defectuoso, restauración de backup y reconciliación posterior.

Gate CI de este contrato:

```bash
npm run ops:smoke
```


## Perfil Kairoseth MongoDB

El modo productivo se activa explícitamente:

```js
createPuenteRuntime({
  persistenceMode: "kairoseth",
  fiscalRecordStore,
  integrationDataStore,
  importSessionStore,
  importBatchStore,
  localAgentRegistryStore,
  aeatOutboxStore,
  backupStatusProvider,
});
```

Este modo no crea SQLite. La ausencia de cualquier store obligatorio o del
provider de backup impide arrancar. El endpoint operacional reporta
`mode: "kairoseth-mongodb"`.
