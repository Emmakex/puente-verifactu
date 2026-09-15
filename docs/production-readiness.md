# Production Readiness — Fase 6

Fase 6 convierte los componentes ya funcionales de Puente VeriFactu en un sistema operable con procedimientos de recuperación, observabilidad y controles de release verificables.

No sustituye el gate externo AEAT de Fase 3. **No puede existir release ni piloto fiscal real mientras #6 siga abierto**, aunque todos los gates internos de esta fase estén verdes.

## Principios

1. Cada capacidad crítica debe tener un procedimiento ejecutable, no solo documentación.
2. Los procedimientos destructivos requieren guardas explícitas y deben fallar de forma segura.
3. Backup sin restore probado no cuenta como backup operativo.
4. Un error técnico nunca debe crear una operación fiscal duplicada.
5. Un resultado remoto incierto nunca se reenvía ciegamente: pasa a `reconciliation_required` hasta que una reconciliación explícita confirme si se puede completar, bloquear o reintentar.
6. Single-node y HA/multi-réplica se tratan como perfiles distintos; no se atribuyen garantías distribuidas a SQLite.
7. La evidencia de release no contiene certificados, claves privadas, tokens ni datos fiscales innecesarios.
8. La observabilidad global nunca se expone a una credencial tenant/integración por defecto; requiere autoridad operacional explícita.

## Gates

### 6.1 Backup/restore durable SQLite

Estado: **implementado**.

Criterios:

- snapshot consistente con WAL activo;
- artefacto no sobrescribible accidentalmente;
- SHA-256 + manifest versionado;
- `PRAGMA integrity_check` y `foreign_key_check`;
- permisos restrictivos del artefacto;
- restore verificado antes de reemplazar un target;
- sustitución in-place solo con confirmación offline;
- rechazo de sidecars WAL/SHM activos;
- prueba end-to-end de recuperación de cadena fiscal, API/idempotencia y sesión de importación;
- corrupción detectada antes de modificar el target.

Comandos:

```bash
npm run sqlite:backup -- --db <source.sqlite> --out <backup.sqlite>
npm run sqlite:verify-backup -- --backup <backup.sqlite>
npm run sqlite:restore -- --backup <backup.sqlite> --db <target.sqlite>
npm run sqlite:backup:smoke
```

El almacenamiento remoto, cifrado del repositorio de backups, retención y agenda del ejercicio periódico dependen del entorno de despliegue y se configuran operacionalmente; no se incrustan credenciales de storage en este repositorio.

### 6.2 Outbox durable de producción

Estado: **implementado para el perfil SQLite single-node y protegido por CI**.

Contrato del gate:

- los jobs AEAT pendientes se persisten en el mismo store durable SQLite del perfil single-node;
- `availableAt`, número de intentos, último resultado y estado sobreviven a reinicios;
- cada dispatch usa lease con propietario y vencimiento para evitar dos workers enviando el mismo job a la vez;
- un lease que vence después de haber empezado un intento no vuelve automáticamente a `pending`: se mueve a `reconciliation_required`;
- un `transport_error` sin respuesta remota verificable también se mueve a `reconciliation_required` y no se reenvía automáticamente;
- respuestas remotas inequívocamente retryable pueden volver a `pending` con backoff persistido;
- respuestas aceptadas, parciales o rechazadas se marcan `completed`; los fallos no retryable restantes quedan `blocked`;
- una operación en `reconciliation_required` solo puede salir mediante una decisión explícita: `complete`, `block` o `retry`;
- `retry` exige haber reconciliado antes el resultado incierto y confirmar que una nueva remisión es segura;
- `runDue()` procesa únicamente jobs `pending` cuyo `availableAt` haya vencido.

Estados operativos:

```text
pending
  -> processing
       -> completed
       -> blocked
       -> pending                  # retry remoto conocido + backoff
       -> reconciliation_required  # transporte ambiguo / crash / lease vencido

reconciliation_required
  -> completed                     # reconciliación confirma recibido/terminado
  -> blocked                       # requiere intervención/corrección
  -> pending                       # solo si se confirma que reintentar es seguro
```

Gate ejecutable:

```bash
npm run aeat:outbox:smoke
```

Las pruebas cubren persistencia tras reinicio, dispatch único, lease activo frente a un segundo worker, expiración de lease tras crash, cuarentena de resultados de transporte inciertos y reintento únicamente después de reconciliación explícita.

**Límite:** este outbox v1 endurece el perfil SQLite single-node. Un despliegue multi-réplica necesitará un store compartido con semántica equivalente de claim/lease y locking distribuido; SQLite no se usa como coordinación entre nodos.

### 6.3 Observabilidad y alertas

Estado: **implementación v1 en validación CI**.

Contrato del gate:

- `/healthz` sigue indicando únicamente proceso vivo;
- `/readyz` sigue indicando únicamente disponibilidad mínima de SQLite;
- `GET /v1/ops/status` expone snapshot operacional agregado y requiere autenticación + permiso `ops:read`;
- una credencial tenant/integración válida sin `ops:read` recibe `403 VF_OPS_FORBIDDEN`;
- el snapshot no contiene NIF, factura, payload de outbox, job IDs, tenant IDs, credenciales ni rutas locales;
- contadores AEAT por estado, pendientes vencidos, leases expirados y edad del pendiente/reconciliación más antiguos se calculan directamente del store durable;
- `reconciliation_required`, `blocked` y lease expirado generan alertas críticas;
- edad de pending genera warning/critical por umbral;
- `PV_BACKUP_MANIFEST_PATH` permite vigilar antigüedad del último backup creado/verificado;
- backup no configurado produce warning, manifest ausente/inválido o demasiado antiguo produce alerta crítica;
- si SQLite falla, el snapshot sigue siendo generable con estado crítico sanitizado en vez de depender de un 500 opaco;
- los códigos de alerta son estables y aptos para integración con el monitor que el despliegue elija.

Umbrales por defecto v1:

- pending AEAT: warning 5 min / critical 15 min;
- backup: warning 26 h / critical 50 h.

Gate ejecutable:

```bash
npm run ops:smoke
```

El contrato completo, incluidos los códigos `VF_OBS_*`, se documenta en `docs/operations-observability.md`.

**Límite:** no se impone todavía un proveedor de monitorización. El endpoint JSON es framework-neutral y puede ser recogido por Prometheus exporter, Grafana Agent, Datadog, Uptime Kuma u otra capa operacional sin acoplarla al motor fiscal.

### 6.4 Runbooks operativos

Pendiente salvo los procedimientos ya documentados de backup/restore y semántica de reconciliación del outbox.

Debe cubrir arranque/parada, recuperación de base, incidente de envío, tratamiento de `reconciliation_required`, degradación AEAT, rotación de credenciales, rollback y verificación post-deploy.

### 6.5 Perfil HA / multi-réplica

Pendiente y separado del perfil SQLite single-node.

Antes de ejecutar múltiples réplicas que escriban estado fiscal se requiere store transaccional compartido, locking/serialización distribuida y rate limiting compartido. SQLite no se promociona como solución HA.

### 6.6 Evidencia de release y verificación regulatoria final

Pendiente.

Debe fijar versiones de artefactos oficiales, WSDL/esquemas/FAQ aplicables, resultados de gates, checksums de artefactos y declaración responsable por versión sin secretos.

### 6.7 Piloto progresivo

Bloqueado por Fase 3 externa y por los gates anteriores.

El piloto debe empezar con alcance controlado, rollback definido y métricas/alertas activas. No se habilita únicamente porque CI esté verde.

## Gate global de salida

Fase 6 solo puede marcarse completa cuando:

- todos los gates internos aplicables estén cerrados con evidencia ejecutable;
- el gate AEAT #6 de Fase 3 esté cerrado;
- exista runbook de operación/recuperación;
- se haya validado el perfil de despliegue que realmente se vaya a usar.
