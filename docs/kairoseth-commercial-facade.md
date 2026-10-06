# Faceta comercial de Puente VeriFactu en Kairoseth

## 1. Separación de identidades

Puente VeriFactu mantiene una separación estricta entre **motor técnico** y **faceta comercial**.

### Identidad técnica

- motor/repositorio: `Puente VeriFactu`;
- slug técnico: `puente-verifactu`;
- repositorio: `Emmakex/puente-verifactu`;
- catálogo técnico: `extensions / puente-verifactu`;
- responsabilidad: core fiscal, AEAT, contratos, adapters, reconciliación, QR/presentation, evidencias, releases y conectores.

### Faceta comercial

La venta y el descubrimiento en Kairoseth utilizan **Kairoseth Fiscal**.

```text
Puente VeriFactu
      ↓ motor técnico
Kairoseth Platform
      ↓
Extensions
      ↓
Kairoseth Fiscal
```

El motor técnico no se renombra. La marca comercial puede evolucionar sin cambiar `product_id=puente-verifactu`, contratos, APIs ni evidencias.

## 2. Estado actual

### Producto técnico

- release publicada: `v0.1.0`;
- runtime probado: `fe4c6360a2b25d44f5044e202f7d2bc2faa626a7`;
- piloto AEAT TEST: 5/5 accepted;
- distribución controlada: validada;
- WooCommerce `0.3.0`: publicado;
- PrestaShop `0.5.0`: publicado;
- Local Agent `0.1.0`: publicado;
- AEAT producción: **deshabilitada**.

### Producto comercial

- nombre: **Kairoseth Fiscal**;
- slug: `kairoseth-fiscal`;
- URL canónica: `/products/kairoseth-fiscal`;
- posicionamiento: **VeriFactu sin cambiar tu software**;
- promesa: **adaptamos el sistema que ya utiliza el cliente en lugar de obligarle a migrar**;
- fase actual: Fase 8 — comercialización;
- pricing definitivo: pendiente de unit economics;
- billing/checkout: pendiente;
- producción AEAT: fuera del scope comercial hasta gate independiente.

## 3. Posicionamiento

Kairoseth Fiscal no debe competir como:

- otro ERP;
- otro programa de facturación generalista;
- una API commodity de bajo precio;
- una solución que obliga a sustituir el sistema actual.

Debe posicionarse como **capa fiscal/adaptadora multi-sistema**.

Mensaje central:

> **No cambies tu sistema. Kairoseth Fiscal adapta lo que ya usas a VeriFactu y a la evolución de la facturación electrónica.**

## 4. Gama comercial

Los modos comerciales son distintas formas de consumir el mismo producto.

### Fiscal Web

Para autónomos y pymes con:

- Excel/CSV;
- carga manual;
- flujo sencillo sin proyecto de integración.

Incluye conceptualmente:

- onboarding visual;
- mapping asistido;
- preflight;
- estado y errores comprensibles;
- fallback manual.

### Fiscal Connect

Para:

- WooCommerce;
- PrestaShop;
- ERP/CRM conectables;
- conectores/adapters estándar.

Incluye conceptualmente:

- integración nativa;
- instalación asistida;
- sincronización;
- estado/reintentos;
- mantenimiento de conector.

### Fiscal API

Para:

- SaaS;
- software propio;
- integradores;
- equipos técnicos.

Incluye conceptualmente:

- REST API;
- starter kits/SDK;
- webhooks;
- MappingProfile;
- contrato estable de integración;
- clasificación fiscal sensible server-side.

### Fiscal Custom

Para:

- ERP/CRM complejos;
- software antiguo/local;
- TPV;
- bases de datos;
- SFTP/watch-folder;
- integraciones especiales.

Incluye conceptualmente:

- diagnóstico técnico;
- implantación gestionada;
- Local Agent cuando aplique;
- soporte y mantenimiento específico.

`Local Agent` no se presenta como producto principal al usuario final; es una capacidad técnica detrás de la solución para software legacy/local.

## 5. Arquitectura pública en kairoseth.com

### Hub

```text
/products/kairoseth-fiscal
```

### Landings existentes

```text
/products/kairoseth-fiscal/woocommerce
/products/kairoseth-fiscal/prestashop
/products/kairoseth-fiscal/erp
/products/kairoseth-fiscal/api
/products/kairoseth-fiscal/excel
/products/kairoseth-fiscal/software-propio
/products/kairoseth-fiscal/software-antiguo
```

### Superficies comerciales previstas

```text
/products/kairoseth-fiscal/precios
/products/kairoseth-fiscal/diagnostico
/products/kairoseth-fiscal/partners
/products/kairoseth-fiscal/faq
```

No se debe duplicar esta familia bajo una segunda raíz pública.

## 6. Funnel

```text
SEO / Ads / Partner / Referencia
            ↓
Landing por intención
            ↓
Diagnóstico
            ↓
Preflight / prueba TEST cuando aplique
            ↓
Propuesta
            ↓
Implantación
            ↓
Validación
            ↓
Soporte recurrente
```

CTA transversal recomendado: **Comprobar mi sistema**.

## 7. Pricing

Modelo recomendado para estudiar:

- setup/implantación;
- cuota recurrente;
- diferenciación por complejidad/canal/soporte;
- pricing partner separado;
- API y Custom con margen suficiente para integración y soporte.

No se fija aquí ningún importe. Los precios solo se publicarán después de unit economics y definición de entitlements.

## 8. Partners

Canales prioritarios:

- agencias web;
- integradores ERP/desarrolladores;
- asesorías/gestorías.

Objetivo: permitir distribución multi-cliente sin que cada partner reconstruya la capa fiscal.

Aspectos a definir en Fase 8:

- referral/margen;
- ownership del cliente;
- soporte L1/L2;
- onboarding;
- control de versiones;
- branding/white-label parcial cuando aplique.

## 9. SEO/GEO

La marca Kairoseth Fiscal no debe ocultar la intención de búsqueda.

Clusters transaccionales prioritarios:

- VeriFactu WooCommerce;
- VeriFactu PrestaShop;
- API VeriFactu;
- VeriFactu ERP;
- VeriFactu Excel;
- software VeriFactu;
- adaptar software a VeriFactu.

La superficie editorial debe cubrir cambios/plazos regulatorios, autónomos, pymes, factura electrónica y guías por plataforma, siempre con revisión de fuente/fecha.

Cada landing debe mantener canonical, metadata, FAQ/schema cuando corresponda, breadcrumbs, enlazado interno y claims verificables.

## 10. Regla de seguridad comercial

La faceta comercial nunca debe:

- activar producción AEAT;
- afirmar certificación oficial inexistente;
- pedir PFX/passphrase o secretos en formularios públicos;
- prometer compatibilidad no validada;
- convertir una fecha regulatoria provisional en claim evergreen definitivo.

Billing concede entitlement comercial; la activación fiscal sigue siendo un gate técnico/regulatorio separado.

## 11. Fuente de verdad y documentación de implementación

### Motor/producto

Este repositorio (`Emmakex/puente-verifactu`) conserva la fuente de verdad de:

- producto técnico;
- contratos;
- release;
- adapters;
- política fiscal;
- alcance de la faceta comercial.

### Web/plataforma

`Emmakex/kairoseth-platform` conserva la fuente de verdad de implementación para:

- rutas públicas;
- UX;
- navegación;
- funnel;
- diagnóstico;
- pricing UI;
- partners;
- analytics;
- billing/entitlements.

Documentos de referencia en Kairoseth Platform:

- `docs/KAIROSETH_FISCAL_COMMERCIAL_ARCHITECTURE_V1.md`;
- `docs/KAIROSETH_FISCAL_WEB_ROADMAP_V1.md`.

Seguimiento de Fase 8: issue `#108` de Puente VeriFactu.

## 12. Regla de cambio

Cualquier cambio material en naming, packaging, rutas, funnel, pricing, partners, claims o modelo de distribución debe actualizar primero o en el mismo PR:

1. esta faceta comercial;
2. la arquitectura comercial de Kairoseth Platform;
3. el issue de Fase 8 cuando cambie el roadmap.
