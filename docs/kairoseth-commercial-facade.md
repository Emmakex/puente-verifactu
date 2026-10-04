# Faceta comercial de Puente VeriFactu en Kairoseth

## Patrón copiado de Puente DeCA → Kairoseth Cargo

Puente VeriFactu adopta el mismo patrón de separación entre **identidad técnica** y **faceta comercial** que ya usamos en DeCA.

### Identidad técnica

- motor/repositorio: `Puente VeriFactu`;
- slug técnico: `puente-verifactu`;
- repositorio: `Emmakex/puente-verifactu`;
- catálogo técnico: `extensions / puente-verifactu`;
- responsabilidad: core fiscal, AEAT, contratos, adapters, reconciliación, QR/presentation y evidencias.

### Faceta comercial

La venta y descubrimiento en Kairoseth deben usar una **marca comercial propia**, igual que:

```text
Puente DeCA      -> Kairoseth Cargo
puente-deca      -> /products/kairoseth-cargo
motor técnico    -> faceta comercial
```

Para VeriFactu la arquitectura queda preparada así:

```text
Puente VeriFactu
      ↓ motor técnico
Kairoseth Platform
      ↓
Extensions
      ↓
Kairoseth Fiscal
      ├── Fiscal Web
      ├── Fiscal Connect
      └── Fiscal API
```

El nombre comercial seleccionado es **Kairoseth Fiscal** y su slug canónico es `kairoseth-fiscal`. **No se renombra el motor técnico ni el repositorio**. La superficie comercial permanece en acceso controlado mientras se completa release/piloto y se aprueban pricing, entitlements y billing.

## Estado comercial

- nombre: **Kairoseth Fiscal**;
- slug: `kairoseth-fiscal`;
- posicionamiento: **VeriFactu para cualquier software**;
- promesa principal: **Conecta tu software con VeriFactu sin cambiar de sistema**;
- disponibilidad: acceso controlado / release candidate;
- billing self-service: deshabilitado;
- prioridad vigente: completar producto, candidato y piloto antes de reabrir pricing/billing.

## Gama comercial

Se replica el patrón de Kairoseth Cargo:

### Fiscal Web

Para autónomos/pymes que trabajan manualmente o con Excel/CSV.

Incluye:
- onboarding visual;
- carga CSV/XLSX;
- mapping asistido;
- preflight;
- estado y errores comprensibles;
- fallback manual.

### Fiscal Connect

Para negocios con ecommerce, ERP o CRM conectable.

Incluye:
- WooCommerce;
- PrestaShop;
- futuros conectores nativos;
- webhook;
- Local Agent / DB / SFTP cuando corresponda.

### Fiscal API

Para ERP/TMS/CRM/software propio y partners técnicos.

Incluye:
- REST API;
- SDK;
- MappingProfile;
- Connector Contract Suite;
- Universal Adapter Manifest;
- integración server-to-server.

Los tres son **formas comerciales del mismo producto/extensión**, no motores distintos.

## Regla de naming

La faceta comercial puede cambiar de nombre sin afectar:

- `product_id=puente-verifactu`;
- repositorio;
- API;
- contratos;
- evidencias;
- conectores;
- migraciones.

El nombre comercial solo afecta a:
- catálogo/landing;
- SEO;
- copy;
- navegación;
- CTAs;
- packaging comercial.

## URL y redirección

Se mantiene el patrón DeCA:

```text
/products/kairoseth-fiscal       -> URL canónica comercial
/products/puente-verifactu        -> redirección permanente a la comercial
```

La redirección ya forma parte de Kairoseth Platform. `puente-verifactu` continúa siendo el identificador técnico y `kairoseth-fiscal` la URL pública/canónica.

## SEO

Aunque la marca comercial sea distinta, la página debe mantener visibles términos como:

- VeriFactu / VERI*FACTU;
- software VeriFactu;
- conectar ERP con VeriFactu;
- WooCommerce VeriFactu;
- PrestaShop VeriFactu;
- Excel VeriFactu;
- API VeriFactu;
- adaptación VeriFactu para software propio.

La marca no debe ocultar la intención de búsqueda regulatoria, del mismo modo que Kairoseth Cargo conserva DeCA en título, descriptor y contenidos.

## Frontera técnica/comercial

```text
Kairoseth Platform
  auth / organizaciones / RBAC / billing / catálogo / workspace
                     |
                     v
        faceta comercial del producto
                     |
                     v
             Puente VeriFactu
       runtime / core / adapters / AEAT
```

No se crea un segundo login, panel de cliente o sistema de organizaciones dentro del motor.
