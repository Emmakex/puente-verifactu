# Faceta comercial de Puente VeriFactu en Kairoseth

## 1. Identidades

Puente VeriFactu mantiene una separación estricta entre motor técnico y faceta comercial.

### Motor técnico

- repositorio: `Emmakex/puente-verifactu`;
- nombre técnico: `Puente VeriFactu`;
- `product_id`: `puente-verifactu`;
- responsabilidad: core fiscal, AEAT, contratos, adapters, reconciliación, evidencias, releases y conectores.

### Producto visible

El nombre visible al cliente en conectores y superficies comerciales es **VeriFactu Software**.

Las rutas históricas `/products/kairoseth-fiscal/...` y otros identificadores internos pueden mantenerse para no romper SEO, integraciones ni contratos. El cambio de nombre visible no renombra el motor técnico.

```text
Puente VeriFactu
      ↓ motor técnico
Kairoseth Platform
      ↓
VeriFactu Software
```

## 2. Posicionamiento

Promesa central:

> **VeriFactu sin cambiar tu software. Conectamos el sistema que ya utilizas con la capa fiscal necesaria y validamos antes de activar producción.**

No competimos como:

- otro ERP;
- otro programa de facturación generalista;
- una API commodity;
- una solución que obliga a migrar el sistema actual.

La propuesta es una capa fiscal/adaptadora multi-sistema para WooCommerce, PrestaShop, ERP, CRM, software propio, API, Excel/CSV y sistemas legacy/locales.

## 3. Contrato comercial aprobado

La autoridad detallada vive en `docs/commercial-product-contract-v1.md`.

Regla resumida:

```text
Instalar plugin/conector      -> GRATIS
Diagnóstico / preflight       -> GRATIS
Conectar con Kairoseth        -> GRATIS
AEAT TEST onboarding          -> GRATIS y limitado
AEAT producción               -> plan ACTIVE + gate fiscal
```

El plugin no es el producto de pago. El servicio fiscal de producción, operación, soporte y entitlements asociados sí lo son.

## 4. Funnel oficial

```text
SEO / Google / WordPress.org / Partner / Referencia
                         ↓
                  Instalar conector
                         ↓
                   Comprobar gratis
                         ↓
               Preflight sin AEAT
                         ↓
               Conectar con Kairoseth
                         ↓
               Onboarding automático
                         ↓
                AEAT TEST controlado
                         ↓
                Activar producción 🔒
                         ↓
                     ACTIVE
                         ↓
                 AEAT producción
```

CTA principal para integraciones estándar: **Comprobar gratis** o **Comprobar mi sistema** según el contexto.

## 5. Gama comercial

Son formas de consumir el mismo producto, no productos fiscales distintos.

### Fiscal Web — 19 € / mes

Para Excel/CSV, carga manual y flujos sencillos. Incluye onboarding visual, mapping asistido, preflight y estado comprensible.

### Fiscal Connect — 49 € / mes

Para WooCommerce, PrestaShop y conectores/adapters estándar. Incluye integración nativa, conexión guiada, sincronización, estado/reintentos y mantenimiento del conector.

### Fiscal API — 99 € / mes

Para SaaS, software propio, integradores y equipos técnicos. Incluye REST API, starter kits/SDK, webhooks y MappingProfile.

### Fiscal Custom — presupuesto gestionado

Para ERP/CRM complejos, software legacy/local, TPV, bases de datos, SFTP/watch-folder e integraciones especiales. No tiene un precio mensual canónico cerrado en v1.

`Local Agent` sigue siendo una capacidad técnica interna y no la categoría principal de compra.

No existe anualidad aprobada.

## 6. Estados comerciales y entitlements

### FREE

Permite:

- instalar;
- conectar;
- preflight/diagnóstico;
- onboarding;
- AEAT TEST limitado.

No permite nuevos envíos a AEAT producción.

### ACTIVE

Permite, además de superar el gate fiscal:

- AEAT producción;
- envío manual/automático según configuración;
- reconciliación y seguimiento;
- rectificativas/anulaciones soportadas;
- histórico operativo;
- soporte/capacidades contratadas.

### SUSPENDED

Mantiene el histórico/consulta aplicable y bloquea nuevas operaciones de producción.

Los planes y precios se traducen a entitlements. El plugin no contiene lógica de precio como autoridad.

## 7. Regla de activación de producción

Producción es fail-closed.

```text
commercial_entitlement = ACTIVE
AND
fiscal_gate = approved
AND
runtime_production_gate = enabled
```

Ni una instalación, ni un preflight correcto, ni un pago pueden saltarse esta regla.

## 8. Onboarding cliente

El cliente no debe manejar:

- URLs internas;
- `auth.json`;
- hashes;
- tokens administrativos;
- IDs técnicos de IntegrationProfile;
- certificados del runtime;
- secretos de AEAT o infraestructura.

Flujo objetivo:

1. instalar;
2. `Conectar con VeriFactu Software`;
3. login o código de activación de un solo uso;
4. Kairoseth resuelve organización/instalación;
5. materializa IntegrationProfile/mapping;
6. emite credencial data-plane scoped;
7. el plugin recibe solo configuración mínima y credencial scoped;
8. health check/preflight;
9. TEST;
10. activación de producción cuando proceda.

## 9. Arquitectura pública

Se conservan como rutas canónicas actuales:

```text
/products/kairoseth-fiscal
/products/kairoseth-fiscal/woocommerce
/products/kairoseth-fiscal/prestashop
/products/kairoseth-fiscal/erp
/products/kairoseth-fiscal/api
/products/kairoseth-fiscal/excel
/products/kairoseth-fiscal/software-propio
/products/kairoseth-fiscal/software-antiguo
```

Superficies previstas:

```text
/products/kairoseth-fiscal/precios
/products/kairoseth-fiscal/diagnostico
/products/kairoseth-fiscal/partners
/products/kairoseth-fiscal/faq
```

El slug histórico no obliga a mostrar `Kairoseth Fiscal` como nombre de producto.

## 10. Pricing y billing

Pricing mensual canónico:

- Fiscal Web: **19 € / mes**;
- Fiscal Connect: **49 € / mes**;
- Fiscal API: **99 € / mes**;
- Fiscal Custom: presupuesto gestionado;
- anualidad: **no aprobada / no disponible**.

WooCommerce y PrestaShop se comercializan normalmente como **Fiscal Connect (49 € / mes)**.

Los métodos operativos iniciales son **Bizum + transferencia bancaria**. Stripe/Redsys continúan diferidos y fail-closed hasta aceptación TEST específica.

Mientras el checkout automático esté aplazado, Kairoseth Platform valida el pago manual y concede el entitlement correspondiente. Cuando exista billing automático, cambiará entitlements; nunca activará por sí solo el gate fiscal de producción.

## 11. WordPress.org y conectores

El plugin WooCommerce puede distribuirse gratis y debe ofrecer valor real antes de contratar:

- instalación;
- conexión;
- preflight sin AEAT;
- TEST limitado.

WordPress.org debe indicar de forma transparente que el uso de AEAT producción requiere cuenta/plan activo de Kairoseth. Para WooCommerce la modalidad estándar es Fiscal Connect, actualmente 49 € / mes.

La UX normal debe ocultar IDs, URLs internas y tokens. Las opciones técnicas quedan en una sección avanzada solo cuando sean necesarias para soporte.

## 12. SEO/GEO

Clusters transaccionales prioritarios:

- VeriFactu WooCommerce;
- VeriFactu PrestaShop;
- API VeriFactu;
- VeriFactu ERP;
- VeriFactu Excel;
- software VeriFactu;
- adaptar software a VeriFactu.

Cada landing mantiene canonical, metadata, FAQ/schema cuando corresponda, breadcrumbs, enlazado interno y claims verificables.

## 13. Seguridad comercial

La faceta comercial nunca debe:

- activar AEAT producción por sí sola;
- afirmar certificación oficial inexistente;
- pedir PFX/passphrase o secretos en formularios públicos;
- exponer credenciales control-plane al plugin;
- prometer compatibilidad no validada;
- convertir fechas regulatorias provisionales en claims evergreen.

## 14. Fuente de verdad

`Emmakex/puente-verifactu` mantiene la fuente de verdad del motor, contratos, release, adapters, política fiscal y frontera comercial.

`Emmakex/kairoseth-platform` mantiene la implementación de web, UX, navegación, onboarding de cuenta, analytics, billing y entitlements.

Documentos coordinados:

- `docs/commercial-product-contract-v1.md` en Puente VeriFactu;
- `docs/VERIFACTU_SOFTWARE_COMMERCIAL_CONTRACT_V1.md` en Kairoseth Platform;
- `docs/KAIROSETH_FISCAL_COMMERCIAL_ARCHITECTURE_V1.md`;
- `docs/KAIROSETH_FISCAL_WEB_ROADMAP_V1.md`.

Seguimiento comercial: issue `#108`.

## 15. Regla de cambio

Todo cambio en naming visible, frontera gratis/pago, funnel, onboarding, entitlements, política TEST, pricing, partners o claims debe actualizar las fuentes de verdad coordinadas en el mismo cambio o en cambios enlazados.