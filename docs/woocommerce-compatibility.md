# WooCommerce — compatibilidad y empaquetado

## Objetivo

El conector nativo no se considera instalable por el mero hecho de pasar `php -l`. Cada cambio debe conservar dos garantías adicionales:

1. el ZIP de plugin se genera de forma reproducible desde una allowlist de runtime;
2. una matriz CI instala ese ZIP sobre WordPress + WooCommerce reales y ejecuta un smoke con HPOS activo.

## Versiones de referencia — 15/09/2026

Fuentes oficiales revisadas:

- WordPress estable: **7.1**, publicado el 19/08/2026 — https://wordpress.org/news/2026/08/wordpress-7-1-mary-lou/
- WooCommerce estable: **11.1.0**, publicado el 03/09/2026 — https://developer.woocommerce.com/2026/09/03/wc-11-1-release-notes/
- índice oficial de releases WooCommerce — https://developer.woocommerce.com/releases/

La matriz inicial cubre:

| Perfil | WordPress | WooCommerce | PHP | Propósito |
| --- | --- | --- | --- | --- |
| mínimo declarado | 6.5 | 8.2.0 | 7.4 | evitar romper el contrato mínimo del plugin |
| transición | 7.0.4 | 11.0.1 | 8.2 | detectar incompatibilidades entre generaciones recientes |
| estable actual | 7.1 | 11.1.0 | 8.3 | validar contra el stack estable vigente al cerrar este gate |

Antes de cada release se deben revisar las versiones estables oficiales y actualizar la matriz cuando corresponda. No se debe cambiar `WC tested up to`, `Tested up to` o el rango soportado únicamente por calendario: primero debe existir evidencia CI.

## Qué prueba cada combinación

El job de compatibilidad:

1. levanta MySQL 8;
2. instala la versión exacta de WordPress;
3. instala y activa la versión exacta de WooCommerce;
4. activa HPOS;
5. genera el ZIP de Puente VeriFactu;
6. instala y activa el ZIP, no la carpeta del monorepo;
7. verifica carga de las clases del conector;
8. verifica registro del hook `woocommerce_order_refunded`;
9. crea un pedido con `wc_create_order()`;
10. construye el payload neutral;
11. guarda y recupera metadata mediante WooCommerce CRUD sobre HPOS.

No llama a AEAT ni necesita secretos.

## ZIP reproducible

Comando:

```bash
npm run woo:package
```

Salida por defecto:

```text
dist/puente-verifactu-woocommerce-0.2.0.zip
```

El empaquetador:

- usa solo Node.js estándar;
- ordena las entradas;
- fija timestamps ZIP;
- conserva una carpeta raíz única `puente-verifactu-woocommerce/`;
- incluye únicamente bootstrap, `includes/*.php`, idiomas y documentación del plugin;
- excluye perfiles server-side de ejemplo, scripts del monorepo, certificados y cualquier secreto;
- imprime SHA-256 del artefacto.

`npm run woo:package:check` construye el artefacto dos veces y exige identidad byte a byte, además de comprobar la allowlist.

## Limitaciones

Esta matriz demuestra compatibilidad técnica del conector, no conformidad fiscal ni aceptación AEAT. El gate externo #6 continúa bloqueando cualquier piloto fiscal o release de producción.
