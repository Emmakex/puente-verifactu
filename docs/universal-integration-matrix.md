# Matriz universal de integración

## Objetivo

Puente VeriFactu debe poder conectarse a casi cualquier sistema de origen sin convertir cada marca, ERP o ecommerce en un producto distinto.

**Producto:** todos estos escenarios pertenecen a una única ficha/producto de **Kairoseth Extensions → Puente VeriFactu**. WooCommerce, PrestaShop, API, Excel, DB, SFTP o Local Agent son canales/adapters de esa extensión, no productos independientes.

La arquitectura se decide por **capacidades**, no por marca ni versión:

```text
Sistema origen
    ↓
Adapter / Ingress
    ↓
MappingProfile
    ↓
InvoiceIntent v1
    ↓
Preflight
    ↓
Idempotencia
    ↓
Motor fiscal único
    ↓
Outbox / AEAT / reconciliación
    ↓
Presentation (QR + textos + estado)
    ↓
Sistema origen
```

El adapter puede leer, transformar y transportar datos, pero **nunca** implementa reglas AEAT, certificados, huellas, encadenamiento ni decisiones fiscales sensibles.

## Selector capability-first

La primera pregunta del onboarding es:

> ¿Qué puede hacer tu sistema hoy?

Orden de preferencia inicial:

| Capacidad disponible | Ruta preferida | Nivel técnico |
|---|---|---|
| Existe conector nativo | `native_plugin` | cero/bajo código |
| Tiene API utilizable | `rest_api` | API/SDK |
| Puede lanzar HTTP/webhooks | `webhook` | low-code |
| Podemos leer BD de forma segura | `database_read` | agente local |
| Puede dejar ficheros automáticamente | `watch_folder` / `sftp` | agente/local |
| Exporta CSV/XLSX | `file_upload` | cero código |
| Podemos instalar agente pero no hay otra interfaz | `local_agent` | bridge local |
| Ninguna de las anteriores | `manual` | respaldo universal |

La ruta seleccionada no modifica el motor fiscal.

## Escenarios

### A. Ecommerce / CMS

Estado actual:

- WooCommerce: conector nativo, HPOS-safe, capability-first.
- PrestaShop: conector nativo, capability-first.
- Futuros ecommerce: deben usar el mismo Universal Adapter Contract y Connector Contract Suite.

Fallback obligatorio: API o archivo.

### B. ERP / CRM / SaaS moderno

Ruta preferida: `rest_api`.

El ERP envía su JSON normal. Puente aplica un `MappingProfile` server-side y devuelve:

- preflight;
- `recordId`;
- estado;
- reconciliación;
- contrato `presentation` con QR/textos cuando corresponda.

El ERP no conoce XML AEAT.

### C. ERP / CRM con webhook

Ruta: `webhook`.

El origen envía eventos HTTP firmados. Puente resuelve tenant, secreto y mapping en servidor. La idempotencia deriva del evento estable del sistema origen.

### D. Excel / CSV

Ruta: `file_upload`.

Flujo productivo Kairoseth:

```text
subir -> detectar columnas -> confirmar mapping -> preflight por fila
      -> confirmación explícita -> batch durable MongoDB
      -> lease -> emisión idempotente -> reanudación
      -> histórico/estado -> export JSON/CSV
```

La plantilla del cliente no tiene que cambiar. El binario original no se persiste:
MongoDB conserva la sesión temporal parseada con TTL y, tras confirmar, los
`InvoiceIntent` congelados necesarios para reanudación/idempotencia.

La emisión directa desde una sesión no confirmada está prohibida.

### E. Software propio

Rutas: `rest_api`, SDK o conector.

Se entrega:

- API canónica;
- SDK;
- conector de referencia;
- Universal Adapter Manifest;
- Connector Contract Suite;
- ejemplos HTTP/JSON.

La integración se valida por contrato, no por framework.

### F. Legacy con base de datos

Ruta: `database_read` mediante agente local.

Principios:

- conexión read-only por defecto;
- PostgreSQL, MySQL/MariaDB y SQL Server mediante drivers desacoplados;
- query o vista configurable;
- `MappingProfile` sobre el resultado;
- cursor/checkpoint durable;
- solo conexiones HTTPS salientes hacia Puente;
- nunca escribir en la BD del ERP salvo adapter independiente, explícito y opt-in.

### G. Legacy que exporta ficheros

Rutas: `watch_folder` o `sftp`.

```text
ERP -> carpeta/SFTP -> agente -> inspect/mapping/preflight
    -> issue -> recibo -> processed/error quarantine
```

CSV/XLSX son formatos iniciales. Otros formatos entran mediante adapters específicos sin tocar el core.

### H. TPV / escritorio / red local

Ruta: `local_agent`.

Objetivo:

- Windows/macOS/Linux;
- sin puertos entrantes;
- HTTPS saliente;
- cola local durable;
- operación offline temporal;
- sincronización idempotente;
- configuración por instalación.

### I. Sin integración técnica

Ruta: `manual`.

Formulario mínimo para factura/rectificación usando exactamente el mismo `InvoiceIntent`, preflight y motor fiscal. Es una vía de respaldo para microempresas, no un segundo motor de facturación.

## Universal Adapter Manifest v1

Cada adapter declara sus capacidades mediante un manifest versionado.

Ejemplo:

```json
{
  "schema_version": 1,
  "kind": "puente-verifactu-adapter-manifest",
  "id": "mi-erp",
  "product": {
    "ecosystem": "kairoseth",
    "catalog": "extensions",
    "product_id": "puente-verifactu"
  },
  "channel": "api",
  "transport": "https-json",
  "mode": "push",
  "mapping": "server-side",
  "capabilities": {
    "preflight": true,
    "issue": true,
    "status": true,
    "sync": true,
    "rectification": true,
    "presentation_return": true,
    "batch": false,
    "offline_queue": false,
    "source_read_only": false
  },
  "security": {
    "secrets_server_side": true,
    "aeat_certificate_server_side": true,
    "tenant_server_authoritative": true
  }
}
```

El manifest describe transporte/capacidades; no concede permisos fiscales.

## Invariantes universales

Todos los canales deben cumplir:

1. preflight antes de efectos;
2. idempotencia estable;
3. tenant/instalación server-authoritative;
4. secretos y certificado solo server-side;
5. reconciliación antes de reemitir cuando existe `recordId`;
6. no mutar historial fiscal cerrado;
7. QR/textos desde el contrato de presentación del core;
8. errores estructurados;
9. adapter reemplazable;
10. fallback universal documentado.

## Orden de implementación

### U1 — Productizar lo existente

- API/SDK;
- webhook;
- CSV/XLSX;
- onboarding capability-first.

### U2 — Universal Adapter Contract v1

- manifest de capacidades;
- selector de ruta;
- validación CI;
- conector de referencia actualizado.

### U3 — Agente local v1

- [x] foundation runtime local Node 22.13+;
- [x] SQLite privado y cola offline durable;
- [x] idempotencia estable por sourceId/sourceKey;
- [x] leases, recuperación tras crash y retry/backoff;
- [x] checkpoint durable;
- [x] discovery watch-folder CSV/XLSX con SHA-256;
- [x] política de HTTPS saliente;
- [x] manifest Local Agent + gate CI;
- [x] watch-folder -> parser -> mapped-source -> server-side mapping/preflight -> issue;
- [x] processed/error quarantine por batch;
- [x] opt-in explícito antes de permitir emisión desde watch-folder;
- [x] redacción de payload/result al cerrar el lote, preservando fingerprint e idempotencia;
- [x] DB read-only PostgreSQL/MySQL/MariaDB/SQL Server con evidencia CI real;
- [x] empaquetado/servicio Linux, Windows y macOS con upgrade/rollback.

### U4 — Conectores de datos

- [x] PostgreSQL;
- [x] MySQL/MariaDB;
- [x] SQL Server;
- [x] SFTP read-only/no destructivo;
- [ ] formatos adicionales cuando exista un caso de producto que los requiera.

### U5 — Manual universal

Formulario mínimo y fallback operativo.

## Regla de release

La expansión de adapters no modifica el cumplimiento fiscal del core. Cada adapter nuevo debe superar la suite contractual y no puede declararse compatible con una plataforma/version concreta hasta que exista evidencia de prueba correspondiente.
