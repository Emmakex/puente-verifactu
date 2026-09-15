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

Este runtime **no activa envío AEAT real**. El gate externo #6 sigue pendiente y bloquea cualquier piloto/release fiscal real.

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
PV_SIF_SYSTEM_ID=<identificador-real>
PV_SIF_INSTALLATION_NUMBER=<numero-instalacion>
PV_TIME_ZONE=Europe/Madrid
```

`PV_AUTH_CONFIG_PATH`, `PV_SIF_SYSTEM_ID` y `PV_SIF_INSTALLATION_NUMBER` son obligatorios. `PV_INTEGRATION_CONFIG_PATH` es opcional si solo se usa contrato canónico/onboarding. `PV_BACKUP_MANIFEST_PATH` es opcional, pero si no se configura el snapshot operacional emite `VF_OBS_BACKUP_MONITORING_UNCONFIGURED`.

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

Endpoint operacional protegido:

- `GET /v1/ops/status` — snapshot agregado; requiere autenticación y `ops:read`.

El snapshot incluye salud SQLite, contadores/edades del outbox AEAT, antigüedad de backup configurado y alertas `VF_OBS_*`. No devuelve NIF, facturas, payloads, job IDs, tenants, secretos ni rutas locales. Ver `docs/operations-observability.md`.

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

El perfil single-node ya dispone de backup/restore verificable, outbox durable y observabilidad operacional v1. Sigue sin presentarse como solución HA/multi-réplica. El gate externo AEAT #6 y los restantes gates de Fase 6 continúan bloqueando release/piloto fiscal real.

Gate de observabilidad:

```bash
npm run ops:smoke
```
