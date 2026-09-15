# Universal Integration Kit v1

## Objetivo

Convertir Puente VeriFactu en una capa realmente **camaleónica**: el sistema del cliente aporta los datos que ya tiene y el puente se encarga de normalizar, validar, fiscalizar y, cuando corresponda, remitir a AEAT.

La integración no exige que el cliente conozca XML AEAT, hashes, certificados ni reglas de transporte.

## Vías de integración

### 1. Canónica — API/SDK

Para software que ya puede construir `InvoiceIntent v1`.

```text
ERP/CRM/ecommerce -> SDK/API -> preflight -> fiscalización -> estado
```

### 2. Mapeada — API/SDK

Para sistemas cuyo vocabulario no coincide con el contrato canónico.

```text
payload origen -> MappingProfile server-side -> InvoiceIntent -> preflight/fiscalización
```

El perfil se configura una vez y se reutiliza. El sistema origen puede seguir llamando a sus campos `NUM_FACTURA`, `fecha_doc`, `vat_amount`, etc.

### 3. Webhook low-code

Para sistemas capaces de lanzar un HTTP POST cuando crean una factura.

El webhook usa `profileId`, HMAC-SHA256, timestamp anti-replay e idempotencia. Perfil y secreto se resuelven exclusivamente en servidor y por tenant/instalación.

### 4. Archivo cero-código

CSV y XLSX reutilizan exactamente el mismo `MappingProfile` y preflight.

```text
archivo existente -> inspección -> mapping asistido -> preflight
```

El lector XLSX es read-only, sin dependencias externas y con límites defensivos. El asistente clasifica propuestas como automáticas o pendientes de revisión y nunca convierte una coincidencia dudosa en decisión fiscal silenciosa.

El wizard de `apps/onboarding` convierte este contrato en una experiencia visual ES/EN:

```text
subir archivo -> elegir hoja -> confirmar columnas -> datos fijos -> validar sin enviar
```

El navegador no procesa la lógica fiscal ni XLSX.

### 5. Conector nativo

WooCommerce, PrestaShop y futuros ERP/CRM reutilizan el SDK y el mismo contrato; ningún conector implementa lógica fiscal propia. Cada conector puede comprobarse con `packages/connector-contract-suite`.

## API v1

- `POST /v1/imports/inspect`
- `POST /v1/imports/{importId}/preflight`
- `DELETE /v1/imports/{importId}`
- `POST /v1/preflight`
- `POST /v1/fiscal-records`
- `GET /v1/fiscal-records/{recordId}`
- `POST /v1/webhooks/{profileId}`

## Identidad server-authoritative

El cliente nunca decide mediante payload:

- `organizationId`;
- `installationId`;
- `sourceSystem` autorizado;
- certificado;
- entorno AEAT;
- permisos o tenant.

Esos valores se derivan del contexto autenticado y sobrescriben cualquier valor enviado por el cliente.

## Idempotencia

`POST /v1/fiscal-records` requiere `Idempotency-Key`.

La misma clave + mismo contenido devuelve el mismo recurso. La misma clave + contenido distinto devuelve `409 VF_API_IDEMPOTENCY_CONFLICT`.

`duplicate` es metadata de la respuesta, no estado durable del recurso. Esto permite reconstruir de forma segura la respuesta después de un reinicio sin alterar el registro persistido.

En el runtime single-node, las reservas HTTP pendientes que quedaron huérfanas por una caída de proceso se liberan durante el arranque. La idempotencia fiscal independiente garantiza que el retry reconstruya el mismo registro en lugar de fiscalizar dos veces.

## Multi-tenant

La consulta de un `recordId` siempre se filtra por el tenant autenticado. Un tenant distinto recibe `404`, evitando revelar incluso la existencia del recurso.

Las sesiones del wizard añaden aislamiento por `organizationId + installationId`. Los perfiles de integración y secretos webhook del runtime también se resuelven por esa misma pareja.

## SDK

`packages/sdk` encapsula autenticación de conector, versión, rutas v1, idempotencia, errores normalizados, preflight, envío y consulta de estado. Es **server-side only**.

## Mapping Assistant

`packages/core/src/mapping-assistant.mjs` aporta el contrato común para CSV/XLSX y UI:

- sugerencias con confianza;
- auto-mapping solo en coincidencias fuertes;
- confirmación explícita para sugerencias `review`;
- overrides manuales limitados a destinos conocidos;
- detección de campos esenciales/configuración fija pendiente;
- borrador de `MappingProfile` reutilizable.

El core rechaza rutas peligrosas (`__proto__`, `prototype`, `constructor`) y perfiles que intenten mapear destinos no permitidos.

## Wizard visual

`apps/onboarding` es una app web ligera y responsive ES/EN con carga CSV/XLSX, selector de hoja, etiquetas humanas, confirmación de mappings, configuración fija y preflight por fila.

La implementación del servicio de importación conserva únicamente los datos parseados necesarios para el preflight; nunca guarda el binario original. En tests/desarrollo puede usar memoria y en el runtime concreto usa el store SQLite durable con TTL.

## Connector Contract Suite

`packages/connector-contract-suite` es un runner framework-neutral para integradores externos. Comprueba:

- `preflight / send / status`;
- ausencia de fiscalización durante preflight;
- `eventId` obligatorio;
- clave de idempotencia estable para el mismo evento y distinta para otro;
- no mutación del payload;
- consulta del `recordId` correcto;
- ausencia de inyección de tenant, certificado, passphrase, entorno AEAT o permisos.

Nuestro conector de referencia usa exactamente el mismo gate:

```bash
npm run contract:reference
```

La suite valida compatibilidad de integración; no constituye certificación regulatoria ni sustituye las pruebas AEAT.

## Runtime HTTP single-node

`apps/server` convierte el handler framework-neutral en un deployment Node ejecutable:

- Basic auth para el wizard detrás de HTTPS;
- Bearer tokens para API/conectores;
- credenciales almacenadas solo como hashes/scrypt;
- contexto organization/installation/source resuelto desde credencial;
- rate limit por credencial;
- `healthz` y `readyz`;
- CSP y cabeceras de seguridad;
- límites de body;
- UI y API mismo-origen, sin CORS abierto;
- perfiles/webhooks cargados desde configuración server-side externa a Git.

El proceso escucha por defecto en `127.0.0.1` y se publica mediante reverse proxy HTTPS.

## Persistencia SQLite

`packages/sqlite-store` implementa el perfil durable simple utilizando `node:sqlite` de Node 22.13+.

Persiste:

- cadena y registros fiscales;
- operaciones/idempotencia fiscal;
- recursos API;
- idempotencia HTTP;
- sesiones parseadas del onboarding.

La cadena usa `BEGIN IMMEDIATE`, WAL en fichero, `synchronous=FULL`, foreign keys y tablas `STRICT`. Las reglas de encadenamiento siguen viviendo en `core` mediante `assertFiscalAppend()`.

SQLite es deliberadamente un perfil de **una sola instancia**. Multi-réplica/HA, almacenamiento distribuido, backups/restauración automatizados y outbox durable de producción corresponden a Fase 6.

## Estado de Fase 4

**Fase 4 completada** a nivel de producto/integración:

- API framework-neutral;
- identidad server-authoritative;
- preflight y creación/consulta idempotente;
- webhook firmado;
- SDK server-side;
- CSV/XLSX;
- Mapping Assistant;
- wizard responsive ES/EN;
- Connector Contract Suite;
- runtime HTTP real con autenticación/rate limits;
- persistencia SQLite durable;
- tests de reinicio/recuperación y gate CI del runtime.

La salida de Fase 4 se cumple: un sistema nuevo puede integrarse sin modificar el motor fiscal.

El gate externo AEAT de Fase 3 sigue bloqueando cualquier piloto fiscal real/release. El runtime de Fase 4 es apto para desarrollo, staging y validación técnica, no para declarar production readiness.
