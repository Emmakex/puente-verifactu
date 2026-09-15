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

El webhook usa:

- `profileId` en la ruta;
- HMAC-SHA256;
- timestamp anti-replay;
- `Idempotency-Key` o `X-Event-Id`;
- secreto resuelto exclusivamente en servidor.

### 4. Archivo cero-código

CSV y XLSX reutilizan exactamente el mismo `MappingProfile` y preflight.

```text
archivo existente -> inspección -> mapping asistido -> preflight -> perfil guardado
```

El lector XLSX es read-only, sin dependencias externas y con límites defensivos. El asistente clasifica propuestas como automáticas o pendientes de revisión y nunca convierte una coincidencia dudosa en decisión fiscal silenciosa.

El wizard de `apps/onboarding` convierte este contrato en una experiencia visual ES/EN:

```text
subir archivo -> elegir hoja -> confirmar columnas -> datos fijos -> validar sin enviar
```

El navegador no procesa la lógica fiscal ni XLSX. El backend crea una sesión temporal, inspecciona el archivo y devuelve únicamente el contrato necesario para la interfaz.

### 5. Conector nativo

WooCommerce, PrestaShop y futuros ERP/CRM reutilizarán el SDK y el mismo contrato; ningún conector implementará lógica fiscal propia.

## API v1 inicial

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

Una reserva de idempotencia que falla antes de completar la operación se libera para permitir un reintento legítimo.

## Multi-tenant

La consulta de un `recordId` siempre se filtra por el tenant autenticado. Un tenant distinto recibe `404`, evitando revelar incluso la existencia del recurso.

Las sesiones del wizard añaden además aislamiento por `organizationId + installationId`.

## SDK

`packages/sdk` encapsula:

- autenticación del conector;
- versión del conector;
- rutas v1;
- `Idempotency-Key`;
- errores normalizados con `correlationId`;
- preflight canónico/mapeado;
- envío canónico/mapeado;
- consulta de estado.

El SDK es **server-side only**.

## Mapping Assistant

`packages/core/src/mapping-assistant.mjs` aporta el contrato común para CSV/XLSX y UI:

- sugerencias con confianza;
- auto-mapping solo en coincidencias fuertes;
- confirmación explícita para sugerencias `review`;
- overrides manuales limitados a destinos conocidos;
- detección de campos esenciales pendientes;
- detección de configuración fija del negocio pendiente;
- borrador de `MappingProfile` reutilizable.

El core también rechaza rutas peligrosas (`__proto__`, `prototype`, `constructor`) y perfiles que intenten mapear destinos no permitidos.

## Wizard visual

`apps/onboarding` es una app web ligera y responsive:

- ES/EN completo;
- carga CSV/XLSX;
- selector de hoja;
- etiquetas humanas en lugar de rutas canónicas;
- confirmación explícita de mappings dudosos;
- configuración fija del negocio;
- preflight con resumen y errores por fila;
- sin envío AEAT.

La implementación de referencia usa sesiones en memoria con TTL de 15 minutos y no conserva el binario original después del parseo.

## Conector de referencia

`connectors/reference` demuestra el patrón mínimo de integración y será la base contractual para conectores nativos posteriores.

## Estado de Fase 4

Implementado:

- API framework-neutral;
- identidad server-authoritative;
- preflight canónico y mapeado;
- creación/consulta idempotente;
- webhook firmado;
- SDK server-side;
- conector de referencia;
- CSV;
- lector XLSX read-only;
- inspección unificada de archivos;
- asistente de mapping con confianza y confirmación;
- wizard visual responsive ES/EN;
- sesiones temporales de importación aisladas;
- hardening de mappings y rutas canónicas;
- tests de tenant isolation, idempotencia, XLSX, mapping, onboarding y contrato SDK.

Pendiente dentro de Fase 4:

- persistencia durable de API/estado y store temporal compartido;
- autenticación real/API keys y rate limits en el deployment;
- suite contractual empaquetada para terceros;
- adaptador HTTP concreto para el entorno de despliegue.

El gate externo AEAT de Fase 3 sigue bloqueando cualquier piloto fiscal real/release, pero no el desarrollo de este kit conforme a ADR-0003.
