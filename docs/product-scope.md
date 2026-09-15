# Visión y alcance

## Problema

Muchos negocios ya facturan desde WordPress/WooCommerce, PrestaShop, ERPs, CRMs o aplicaciones propias. Reescribir cada sistema para cumplir con VERI*FACTU multiplica coste y riesgo. Puente VeriFactu desacopla la plataforma de negocio de la lógica fiscal y de comunicación con AEAT.

## Propuesta

Un servicio/núcleo reusable que:

1. Recibe una operación fiscal normalizada desde un adaptador.
2. Valida identidad del emisor, factura, impuestos, series, importes y metadatos.
3. Genera el registro fiscal canónico y su representación AEAT.
4. Encadena la huella conforme a la especificación vigente.
5. Persiste el registro inmutable y su estado de remisión.
6. Envía a AEAT en modalidad VERI*FACTU.
7. Procesa aceptación, aceptación con errores o rechazo.
8. Devuelve un resultado estable al sistema origen.
9. Genera la información necesaria para QR y estado verificable cuando corresponda.

## Usuarios objetivo

- Empresas y autónomos con software de facturación existente.
- Agencias y desarrolladores que necesitan integrar clientes heterogéneos.
- Proveedores de ERP/CRM/ecommerce que quieran delegar la complejidad VERI*FACTU.
- Kairoseth Extensions como ecosistema de conectores.

## MVP

Incluye:

- modalidad **solo VERI*FACTU**;
- multiempresa/multitenant con aislamiento estricto;
- registros de alta y anulación/subsanación conforme a contratos AEAT;
- modelo fiscal canónico independiente del origen;
- hash/encadenamiento;
- remisión, reintentos seguros e idempotencia;
- almacenamiento de request/response y auditoría mínima;
- certificados/credenciales por organización sin exposición al cliente;
- entorno de pruebas AEAT y entorno productivo separados;
- primer adaptador de referencia de Kairoseth Extensions;
- ES/EN para UI y mensajes de cliente.

## Fuera del MVP

- Modo NO VERI*FACTU.
- Contabilidad general.
- Sustituir al ERP/CRM de origen.
- Gestión completa de cobros.
- Factura electrónica B2B derivada de otras normas: se tratará como iniciativa independiente aunque pueda compartir datos.
- SII cuando el obligado esté fuera del ámbito RRSIF por ese régimen.
- TicketBAI u otros sistemas forales; podrán añadirse como motores fiscales independientes.

## Criterios de éxito

- Cero duplicados ante reintentos del origen.
- Trazabilidad de cada registro desde origen hasta respuesta AEAT.
- Imposibilidad de editar registros fiscalmente finalizados.
- Recuperación automática de fallos transitorios sin romper orden ni cadena.
- Suite contractual capaz de certificar adaptadores sin conocer su implementación interna.
