# Puente VeriFactu — HTTP Server

Runtime concreto para un despliegue simple de una sola instancia.

## Perfil de despliegue

```text
HTTPS reverse proxy
        |
        v
127.0.0.1:8787
Puente HTTP server
   |           |
   v           v
API         Onboarding ES/EN
   |
   v
SQLite durable store
```

El proceso escucha en `127.0.0.1` por defecto. En un servidor real debe publicarse detrás de un reverse proxy HTTPS (Caddy, Nginx, Traefik o equivalente). No debe exponerse en HTTP abierto a Internet.

Este runtime **no activa por sí solo envío AEAT real**. El gate externo #6 ya está cerrado y el repositorio está en estado `release_candidate`; la publicación/piloto sigue condicionada a la declaración responsable definitiva y a los gates restantes de Fase 6.

## Requisitos

- Node.js 22.13+;
- volumen persistente para SQLite;
- fichero de credenciales fuera de Git;
- identificadores SIF configurados por entorno.

## Variables

```text
PV_HOST=127.0.0.1
PV_PORT=8787
PV_DATABASE_PATH=/var/lib/puente-verifactu/puente.sqlite
PV_AUTH_CONFIG_PATH=/etc/puente-verifactu/auth.json
PV_INTEGRATION_CONFIG_PATH=/etc/puente-verifactu/integrations.json
PV_BACKUP_MANIFEST_PATH=/var/backups/puente-verifactu/latest.sqlite.manifest.json
PV_RESPONSIBLE_DECLARATION_PATH=/etc/puente-verifactu/declaracion-responsable-v0.1.0.md
PV_AEAT_ENVIRONMENT=test
PV_SIF_SYSTEM_ID=<identificador-real>
PV_SIF_INSTALLATION_NUMBER=<numero-instalacion>
PV_TIME_ZONE=Europe/Madrid
```

`PV_AUTH_CONFIG_PATH`, `PV_SIF_SYSTEM_ID` y `PV_SIF_INSTALLATION_NUMBER` son obligatorios. `PV_INTEGRATION_CONFIG_PATH` es opcional si solo se usa contrato canónico/onboarding. `PV_BACKUP_MANIFEST_PATH` es opcional, pero si no se configura el snapshot operacional emite `VF_OBS_BACKUP_MONITORING_UNCONFIGURED`. Para una versión que vaya a ponerse a disposición de usuarios/clientes, `PV_RESPONSIBLE_DECLARATION_PATH` debe apuntar al documento definitivo de esa versión, almacenado fuera de Git con permisos restrictivos. `PV_AEAT_ENVIRONMENT` controla únicamente la URL de presentación/cotejo QR expuesta a conectores: `test` usa el endpoint de pruebas y `production` el endpoint oficial de producción. El valor por defecto seguro es `test`.

## Autenticación

### API / conectores — Bearer

El fichero no guarda el token en claro, solo SHA-256:

```json
{
  "credentials": [
    {
      "id": "erp-001",
      "type": "bearer",
      "tokenSha256": "<64-hex>",
      "organizationId": "org-001",
      "installationId": "erp-principal",
      "sourceSystem": "mi-erp",
      "rateLimitPerMinute": 120
    }
  ]
}
```

Una credencial normal **no** puede leer métricas globales del runtime.

### Operación / monitorización

Para `GET /v1/ops/status` se exige `ops:read` explícito:

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

Los permisos admitidos se validan con allowlist. Un permiso desconocido hace fallar la configuración al arrancar. Las credenciales existentes sin `permissions` continúan siendo válidas y reciben lista vacía.

### Wizard web — Basic

Para el navegador se soporta Basic auth detrás de HTTPS. Solo se guardan salt + scrypt:

```json
{
  "id": "owner-001",
  "type": "basic",
  "username": "propietario",
  "passwordSalt": "<32-hex>",
  "passwordScrypt": "<128-hex>",
  "organizationId": "org-001",
  "installationId": "file-upload",
  "sourceSystem": "file-upload",
  "rateLimitPerMinute": 60
}
```

Generar hashes sin pasar el secreto como argumento visible:

```bash
read -s PV_SECRET && printf '%s' "$PV_SECRET" | npm run auth:hash -- bearer
read -s PV_SECRET && printf '%s' "$PV_SECRET" | npm run auth:hash -- basic --username propietario
unset PV_SECRET
```

Copiar únicamente los hashes/salt al fichero externo. Protegerlo con permisos del sistema operativo y no guardarlo en Git.

## Perfiles de integración

Los `MappingProfile` y secretos webhook se resuelven server-side y se limitan a organización + instalación:

```json
{
  "integrations": [
    {
      "id": "erp-v1",
      "organizationId": "org-001",
      "installationId": "erp-principal",
      "mappingProfile": {
        "profileVersion": 1,
        "id": "erp-v1",
        "name": "ERP principal",
        "sourceType": "api",
        "fields": {
          "NUM_FACTURA": "number"
        },
        "transforms": {},
        "constants": {},
        "defaults": {}
      }
    }
  ]
}
```

Si se configura `webhookSecret`, ese fichero pasa a contener un secreto y debe tratarse como material sensible.

## Arranque

```bash
npm run server
```

Endpoints públicos mínimos:

- `GET /healthz` — proceso vivo;
- `GET /readyz` — SQLite accesible.

Endpoint autenticado de información legal:

- `GET /declaracion-responsable` — declaración responsable individualizada de la versión configurada. Se sirve en modo `inline`, con `Cache-Control: no-store`, y requiere la misma autenticación Basic que el wizard. Si el deployment no configura el documento, falla cerrado con `503 VF_RESPONSIBLE_DECLARATION_NOT_CONFIGURED`.

Las respuestas de `POST /v1/fiscal-records` y `GET /v1/fiscal-records/:id` incluyen `presentation`, con URL QR AEAT, textos VERI*FACTU, versión de especificación y parámetros de renderizado. Los conectores deben consumir estos metadatos; no reconstruirlos localmente.

Endpoint operacional protegido:

- `GET /v1/ops/status` — snapshot agregado; requiere autenticación y `ops:read`.

El snapshot incluye salud SQLite, contadores/edades del outbox AEAT, antigüedad de backup configurado y alertas `VF_OBS_*`. No devuelve NIF, facturas, payloads, job IDs, tenants, secretos ni rutas locales. Ver `docs/operations-observability.md`.

## Kairoseth Local Agent control plane

The reference runtime exposes management routes for a trusted Kairoseth server credential with `agents:manage`:

- `POST /v1/control-plane/local-agents` — provision an installation and return its bearer token once;
- `GET /v1/control-plane/local-agents` — list sanitized installation state;
- `PATCH /v1/control-plane/local-agents` — set label / desired version / update policy;
- `POST /v1/control-plane/local-agents/rotate-credential` — rotate the bearer token;
- `POST /v1/control-plane/local-agents/revoke` — revoke the installation credential;
- `POST /v1/local-agent/heartbeat` — agent-only heartbeat.

Only the SHA-256 digest of the generated Local Agent token is persisted. List/status APIs never return token hashes or reusable credentials.

The Local Agent heartbeat identity is derived from authentication. Tenant/install/source identity in the heartbeat body is rejected.

The SQLite registry is a **reference single-node implementation**, not a separate production Kairoseth identity or tenant database. The control-plane service validates an injectable registry contract and `createPuenteRuntime({ localAgentRegistryStore })` can bind Kairoseth's shared production persistence.

A Kairoseth management credential example:

```json
{
  "id": "kairoseth-agent-manager",
  "type": "bearer",
  "tokenSha256": "<64-hex>",
  "organizationId": "kairoseth-control",
  "installationId": "control-plane",
  "sourceSystem": "kairoseth",
  "rateLimitPerMinute": 600,
  "permissions": ["agents:manage"]
}
```

No Local Agent management route moves AEAT certificates, fiscal rules or tenant authority out of Kairoseth.

## Rate limiting

Se aplica por `credentialId`; cada credencial define `rateLimitPerMinute`, incluida la credencial operacional. En este perfil single-node el contador vive en memoria. Un deployment multi-réplica deberá sustituirlo por rate limiting compartido en Fase 6.

## Seguridad HTTP

- sin CORS abierto;
- CSP para el wizard;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `Referrer-Policy: no-referrer`;
- permisos de cámara/micrófono/geolocalización desactivados;
- respuestas API/ops con `Cache-Control: no-store`;
- body limitado a 6 MiB a nivel HTTP;
- importador limitado adicionalmente a 5 MiB;
- identidad de organización/instalación/origen derivada de la credencial, nunca del payload;
- métricas globales separadas de credenciales tenant mediante `ops:read`.

## SQLite y Production Readiness

El runtime comparte un único store durable entre cadena fiscal, API/idempotencia, sesiones temporales de importación y outbox AEAT. Ver `packages/sqlite-store/README.md`.

El perfil single-node ya dispone de backup/restore verificable, outbox durable, observabilidad operacional v1 y acceso autenticado a la declaración responsable de la versión. Sigue sin presentarse como solución HA/multi-réplica. La publicación/piloto fiscal real continúa condicionada a completar el cierre regulatorio de la versión y el piloto progresivo.

Gate de observabilidad:

```bash
npm run ops:smoke
```
