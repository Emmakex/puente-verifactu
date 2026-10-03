# Production Readiness — Fase 6

Fase 6 convierte los componentes ya funcionales de Puente VeriFactu en un sistema operable con procedimientos de recuperación, observabilidad y controles de release verificables.

El gate externo AEAT de Fase 3 quedó cerrado el 2026-10-03 con evidencia sanitizada. **Esto no autoriza por sí solo un release ni un piloto fiscal real**: la versión candidata aún debe cumplir los gates restantes de esta fase y contar con su declaración responsable definitiva.

## Principios

1. Cada capacidad crítica debe tener un procedimiento ejecutable, no solo documentación.
2. Los procedimientos destructivos requieren guardas explícitas y deben fallar de forma segura.
3. Backup sin restore probado no cuenta como backup operativo.
4. Un error técnico nunca debe crear una operación fiscal duplicada.
5. Un resultado remoto incierto nunca se reenvía ciegamente: pasa a `reconciliation_required` hasta que una reconciliación explícita confirme si se puede completar, bloquear o reintentar.
6. Single-node y HA/multi-réplica se tratan como perfiles distintos; no se atribuyen garantías distribuidas a SQLite.
7. La evidencia de release no contiene certificados, claves privadas, tokens ni datos fiscales innecesarios.
8. La observabilidad global nunca se expone a una credencial tenant/integración por defecto; requiere autoridad operacional explícita.
9. Una política de backup implementada en código no acredita un entorno real hasta que ese entorno produzca evidencia válida de copia remota cifrada y restore drill.
10. Un CI verde no equivale a autorización de release: el estado de blockers regulatorios se evalúa de forma separada y explícita.

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

### 6.1b Ciclo de vida, copia remota y restore drill

Estado: **política y tooling v1 implementados; conformidad de cada deployment depende de su evidencia real**.

Contrato del gate:

- política versionada y proveedor-neutral en `config/backup-policy.example.json`;
- backup local más reciente con antigüedad máxima configurable (26 h por defecto);
- copia remota obligatoria por checksum para cada artefacto retenido;
- cifrado en reposo remoto obligatorio por defecto;
- retención 7 diarios / 5 semanales / 12 mensuales por defecto;
- cálculo de candidatos a poda sin borrado automático;
- restore drill real a directorio temporal, con checksum, `integrity_check` y `foreign_key_check`;
- evidencia del restore drill con antigüedad máxima configurable (90 días por defecto);
- el check falla cerrado ante backup vencido, copia remota ausente/no cifrada o drill ausente/vencido.

Comandos:

```bash
npm run backup:restore-drill -- --backup <backup.sqlite> --evidence <drill.json>
npm run backup:lifecycle:check -- \
  --dir <backup-dir> \
  --policy <backup-policy.json> \
  --remote-evidence <remote-copies.json> \
  --restore-drill-evidence <drill.json>
npm run backup:lifecycle:smoke
```

La evidencia remota contiene únicamente checksum, timestamp, flag de cifrado y referencia opaca; nunca secretos del proveedor. El uploader/scheduler externo sigue siendo responsabilidad del entorno de despliegue y puede ser S3-compatible, B2, Azure, GCS, storage gestionado u otro sistema equivalente. Ver `docs/backup-lifecycle-policy.md`.

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

Estado: **implementado para el perfil single-node y protegido por CI**.

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

Estado: **implementados para el perfil single-node y protegidos por `npm run check`**.

Índice: `docs/runbooks/README.md`.

Cobertura obligatoria:

- deploy/rollback con backup previo verificado, health/readiness y verificación de `/v1/ops/status` antes de reabrir tráfico;
- rollback de código sin restore automático de base;
- recuperación de base mediante backup/restore offline protegido;
- incidente AEAT y tratamiento de `reconciliation_required` sin reemisión ciega;
- degradación AEAT diferenciando pending no despachado de resultado remoto incierto;
- rotación de credenciales Bearer/Basic y autoridad operacional `ops:read` sin guardar secretos en Git;
- verificación post-deploy/post-restore y registro de evidencia mínima no sensible.

Runbooks:

- `docs/runbooks/deploy-rollback.md`;
- `docs/runbooks/aeat-incident-reconciliation.md`;
- `docs/runbooks/backup-restore.md`;
- `docs/runbooks/credential-rotation.md`.

Gate ejecutable:

```bash
npm run runbooks:check
```

El gate forma parte de `npm run check`, por lo que CI falla si desaparece un procedimiento, una guarda crítica o un comando operativo documentado.

**Límite:** los runbooks actuales describen el perfil single-node. Cualquier deployment HA/multi-réplica deberá tener procedimientos específicos para su store compartido, locking y rate limiting antes de producción.

### 6.5 Perfil HA / multi-réplica

Estado para el perfil actual `sqlite-single-node`: **no aplicable**.

No se añade complejidad distribuida únicamente para cerrar una casilla. Si un deployment futuro ejecuta múltiples réplicas escritoras de estado fiscal, entonces se convierte en gate obligatorio y deberá incorporar store transaccional compartido, locking/serialización distribuida, claims/leases y rate limiting compartidos. SQLite no se promociona como coordinación entre nodos.

La decisión queda fijada en `config/release-gates.json` como `HA_MULTI_REPLICA = not_applicable` para el perfil actual.

### 6.6 Evidencia de release y verificación regulatoria

Estado: **tooling/evidencia interna v1 implementados; gate externo #6 cerrado; cierre regulatorio final pendiente de evidencia de release del commit candidato final y de la declaración responsable definitiva**.

Contrato interno:

- `config/regulatory-sources.json` registra la fecha de revisión y las fuentes oficiales mínimas AEAT/BOE;
- las versiones WSDL/documento de validaciones/esquema/registro deben coincidir exactamente con `AEAT_ARTIFACTS` del adaptador;
- la revisión regulatoria caduca a los 90 días y el gate falla si no se vuelve a validar;
- `config/release-gates.json` conserva AEAT #6 como blocker auditado en estado `closed` y permite `release_candidate` al no quedar blockers abiertos;
- mientras exista cualquier blocker abierto, el único estado válido es `release_blocked`;
- el generador exige el commit fuente explícito y no inspecciona variables de entorno de forma implícita;
- construye en memoria los ZIP reproducibles WooCommerce y PrestaShop y registra versión + SHA-256;
- los fingerprints deben ser idénticos entre ejecuciones sobre el mismo código;
- la evidencia referencia el checklist previo a la declaración responsable, pero no lo presenta como documento firmado ni como certificación AEAT.
- la declaración responsable se genera desde un fichero privado del productor, fuera de Git, y el runtime la expone de manera autenticada en `GET /declaracion-responsable`;
- un deployment candidato debe configurar `PV_RESPONSIBLE_DECLARATION_PATH`; si falta o el fichero no es legible, la ruta falla cerrada y no simula una declaración inexistente.
- `npm run release:finalize` une la evidencia del commit candidato con la declaración privada mediante SHA-256, sin incorporar su contenido al bundle ni al repositorio.

Comandos:

```bash
npm run release:evidence:check
npm run release:evidence -- --commit <SHA40> --expect release_candidate
```

Opcionalmente puede escribirse `--output dist/release-evidence.json`; el fichero no se sobrescribe si ya existe.

Ver `docs/release-evidence.md` y `docs/release/declaracion-responsable-template.md`.

**Cierre regulatorio final:** AEAT #6 ya está cerrado con prueba externa controlada y evidencia no sensible. Resta mantener vigente la revisión regulatoria, ejecutar CI completo para el commit candidato final, generar una evidencia de release nueva para ese mismo commit y preparar/aprobar la declaración responsable definitiva. `release_candidate` no equivale a versión publicada ni autorizada para producción.

### 6.7 Piloto progresivo

Estado: **tooling de readiness implementado; ejecución real pendiente de aprobación explícita y evidencia del deployment**.

El gate `npm run pilot:readiness` falla cerrado y exige, para el mismo commit candidato:

- bundle final `candidate_evidence_complete`;
- aprobación humana privada que referencia exactamente el SHA-256 de la declaración revisada;
- CI del candidato en `success` y cero blockers;
- snapshot `/v1/ops/status` completamente `ok`, sin warnings ni critical;
- cero `reconciliation_required`, cero `blocked` y cero leases expirados;
- backup monitoring configurado y `ok`;
- backup lifecycle real `ok` con copia remota/restore drill según la política del deployment;
- política de piloto con stop conditions obligatorias;
- rollback `code-first-no-automatic-db-restore`.

El recibo `pilot_ready` es sanitizado, no incluye la declaración, tokens, NIF ni rutas privadas. La aprobación privada se conserva fuera de Git y no es creada automáticamente por el sistema.

La política de ejemplo comienza con una ventana interna conservadora de hasta 5 operaciones o 120 minutos. Es una decisión de ingeniería del proyecto, no un límite normativo.

El piloto real sigue pendiente hasta que el productor apruebe expresamente la declaración responsable definitiva y la apertura de la ventana controlada.

## Gate global de salida

Fase 6 solo puede marcarse completa cuando:

- todos los gates internos aplicables al perfil elegido están cerrados con evidencia ejecutable;
- el deployment seleccionado satisface su política de backup con evidencia real;
- el gate AEAT #6 de Fase 3 está cerrado;
- existe evidencia de release para el commit exacto candidato;
- la revisión regulatoria está vigente;
- la declaración responsable definitiva de esa versión ha sido preparada y aprobada;
- existe runbook de operación/recuperación;
- se ha validado el perfil de despliegue que realmente se vaya a usar.
