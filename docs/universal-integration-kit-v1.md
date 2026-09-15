# Universal Integration Kit v1

## Objetivo

Convertir Puente VeriFactu en una capa realmente **camaleónica**: el sistema del cliente aporta los datos que ya tiene y el puente se encarga de normalizar, validar, fiscalizar y, cuando corresponda, remitir a AEAT.

La integración no exige que el cliente conozca XML AEAT, hashes, certificados ni reglas de transporte.

## Vías de integración

### 1. Canónica — API/SDK

Para software que ya puede construir `InvoiceIntent v1`.

Flujo:

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

### 4. Archivo

CSV ya implementado como vía cero-código. XLSX se añadirá en esta misma fase sobre el mismo `MappingProfile`.

### 5. Conector nativo

WooCommerce, PrestaShop y futuros ERP/CRM reutilizarán el SDK y el mismo contrato; ningún conector implementará lógica fiscal propia.

## API v1 inicial

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

## Conector de referencia

`connectors/reference` demuestra el patrón mínimo de integración y será la base contractual para conectores nativos posteriores.

## Estado de Fase 4

Primera entrega implementada:

- API framework-neutral;
- identidad server-authoritative;
- preflight canónico y mapeado;
- creación/consulta idempotente;
- webhook firmado;
- SDK server-side;
- conector de referencia;
- tests de tenant isolation, idempotencia y contrato SDK.

Pendiente dentro de Fase 4:

- persistencia durable de API/estado;
- autenticación real/API keys y rate limits en el deployment;
- XLSX;
- UI/flujo asistido de mapping;
- suite contractual empaquetada para terceros;
- adaptador HTTP concreto para el entorno de despliegue.

El gate externo AEAT de Fase 3 sigue bloqueando cualquier piloto fiscal real/release, pero no el desarrollo de este kit conforme a ADR-0003.
