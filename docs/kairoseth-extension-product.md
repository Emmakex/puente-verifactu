# Puente VeriFactu como producto de Kairoseth Extensions

> Patrón de referencia: **Puente DeCA → Kairoseth Cargo**. En VeriFactu mantenemos igualmente separado el nombre técnico del motor y la faceta comercial de Kairoseth.


## Posición dentro de Kairoseth

Puente VeriFactu no es una colección de productos separados por ERP ni un servicio aislado fuera del ecosistema.

La estructura de producto es:

```text
Kairoseth
└── Extensions
    └── Puente VeriFactu
        ├── Core fiscal único
        ├── Onboarding
        ├── Runtime / API
        ├── WooCommerce adapter
        ├── PrestaShop adapter
        ├── API / SDK adapter
        ├── Webhook adapter
        ├── CSV/XLSX adapter
        ├── Database adapter
        ├── Watch-folder / SFTP adapter
        ├── Local Agent
        └── Manual fallback
```

Para cliente, catálogo, activación y futura comercialización existe **un solo producto/extensión**, pero con dos identidades coordinadas:

- **técnica:** `Puente VeriFactu` / `puente-verifactu`;
- **comercial:** faceta Kairoseth con nombre propio, siguiendo el patrón de `Kairoseth Cargo`.

El nombre comercial definitivo queda pendiente de naming; no debe bloquear el desarrollo técnico. Cuando se fije, la URL comercial será `/products/<slug-comercial>` y la ruta técnica `/products/puente-verifactu` podrá redirigir de forma permanente.

Los adapters son capacidades/modos de conexión de esa extensión. No son productos independientes.

## Regla de producto

Todo nuevo canal debe responder a estas preguntas:

1. ¿Pertenece a Puente VeriFactu?
2. ¿Qué capacidad del sistema origen resuelve?
3. ¿Qué adapter utiliza?
4. ¿Cómo termina en el mismo `InvoiceIntent v1`?
5. ¿Cómo devuelve estado/presentation al origen?

Si una propuesta necesita otro motor fiscal o otro lifecycle de producto, no es un adapter de Puente y debe tratarse como otra extensión/iniciativa.

## Separación de responsabilidades

### Kairoseth

Responsable de la superficie de producto:

- catálogo de Extensions;
- alta/activación de la extensión;
- identidad de organización;
- instalación/configuración;
- estado general;
- documentación comercial y soporte;
- futuras reglas de plan/licencia si aplican.

### Puente VeriFactu

Responsable de:

- onboarding capability-first;
- perfiles de integración;
- adapters;
- contrato canónico;
- core fiscal;
- AEAT;
- QR/presentation;
- reconciliación;
- observabilidad específica;
- evidencias de release.

### Sistema del cliente

Responsable únicamente de aportar/recibir datos mediante el adapter seleccionado.

## Experiencia esperada en Kairoseth

La entrada conceptual del usuario será:

```text
Kairoseth
  -> Extensions
  -> <faceta comercial de Puente VeriFactu>
  -> Activar / Configurar
  -> ¿Qué puede hacer tu sistema?
  -> seleccionar canal
  -> mapping/preflight
  -> activar integración
  -> estado operativo
```

No se presentará al cliente una extensión “WooCommerce VeriFactu”, otra “Excel VeriFactu” y otra “ERP VeriFactu”. Todas son instalaciones/canales de **Puente VeriFactu**.

## Identidad estable

El producto queda identificado internamente por:

- ecosystem: `kairoseth`;
- catalog: `extensions`;
- product_id: `puente-verifactu`;
- technical name: `Puente VeriFactu`;
- technical slug: `puente-verifactu`;
- commercial facade: habilitada, naming pendiente;
- patrón comercial: `Puente DeCA → Kairoseth Cargo`;
- versión del producto: `0.1.0`;
- manifest: `config/kairoseth-extension.json`.

La versión del producto es distinta de la versión de cada adapter empaquetado. Por ejemplo, Puente puede ser 0.1.0 mientras WooCommerce es 0.3.0 y PrestaShop 0.5.0.

## Infraestructura Kairoseth

La superficie productiva de esta extensión debe respetar la infraestructura real de Kairoseth:

- hosting: **Hostinger**;
- persistencia de plataforma/control plane: **MongoDB**;
- tenant/organization authority: Kairoseth;
- secretos y certificado: backend de Kairoseth;
- Local Agent: edge connector sin autoridad fiscal.

El runtime SQLite de este repositorio es una implementación standalone de referencia y pruebas. No debe interpretarse como sustituto de MongoDB en el deployment productivo Kairoseth.

Las bases PostgreSQL, MySQL/MariaDB y SQL Server pertenecen al catálogo de **fuentes externas read-only** que el Local Agent puede consultar en instalaciones de clientes. No son infraestructura de Kairoseth.

## Regla de arquitectura

Los adapters pueden evolucionar y versionarse de forma independiente, pero:

- no duplican reglas AEAT;
- no poseen certificado fiscal;
- no eligen tenant;
- no alteran el core;
- no se comercializan como producto separado dentro del diseño base;
- siempre reportan que pertenecen a `kairoseth/extensions/puente-verifactu`.

## Roadmap de integración con Kairoseth Platform

Antes de una distribución comercial amplia:

1. registrar Puente VeriFactu en el catálogo Kairoseth Extensions;
2. definir contrato de activación/instalación entre Kairoseth y el runtime de Puente;
3. conectar organization/installation de Kairoseth con la identidad server-authoritative de Puente;
4. exponer estado resumido y onboarding desde la superficie Kairoseth;
5. mantener secretos/certificados en backend, nunca en frontend de catálogo;
6. permitir descargar/instalar adapters desde la ficha de la misma extensión;
7. conservar el fallback universal incluso cuando exista un conector nativo.

Este repositorio sigue siendo la implementación técnica de la extensión; Kairoseth Platform es su superficie de producto.
