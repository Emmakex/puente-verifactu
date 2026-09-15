# Production Readiness — Fase 6

Fase 6 convierte los componentes ya funcionales de Puente VeriFactu en un sistema operable con procedimientos de recuperación, observabilidad y controles de release verificables.

No sustituye el gate externo AEAT de Fase 3. **No puede existir release ni piloto fiscal real mientras #6 siga abierto**, aunque todos los gates internos de esta fase estén verdes.

## Principios

1. Cada capacidad crítica debe tener un procedimiento ejecutable, no solo documentación.
2. Los procedimientos destructivos requieren guardas explícitas y deben fallar de forma segura.
3. Backup sin restore probado no cuenta como backup operativo.
4. Un error técnico nunca debe crear una operación fiscal duplicada.
5. Single-node y HA/multi-réplica se tratan como perfiles distintos; no se atribuyen garantías distribuidas a SQLite.
6. La evidencia de release no contiene certificados, claves privadas, tokens ni datos fiscales innecesarios.

## Gates

### 6.1 Backup/restore durable SQLite

Estado: implementado en el PR de backup/restore v1.

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

Pendiente.

Debe garantizar reintentos recuperables tras reinicio, backoff persistido, no duplicación, límites de concurrencia y reconciliación tras resultados inciertos.

### 6.3 Observabilidad y alertas

Pendiente.

Debe incluir métricas operativas accionables como mínimo para colas, errores, reintentos, edad de operaciones pendientes, disponibilidad AEAT/bridge, backup reciente y fallos de integridad/restauración. Los logs deben continuar sanitizados.

### 6.4 Runbooks operativos

Pendiente salvo el procedimiento de backup/restore ya documentado.

Debe cubrir arranque/parada, recuperación de base, incidente de envío, degradación AEAT, rotación de credenciales, rollback y verificación post-deploy.

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
