# Activación de cliente WooCommerce — VeriFactu Software

## Objetivo

El cliente de WooCommerce no configura endpoints, `IntegrationProfile`, `MappingProfile`, tokens administrativos, MongoDB ni credenciales AEAT.

La superficie normal de cliente se limita a:

1. instalar **VeriFactu Software** en WooCommerce;
2. recibir una clave de conexión KFS2 emitida para su tienda;
3. pegarla en el plugin y pulsar **Conectar con VeriFactu Software**;
4. elegir la fuente real del número de factura;
5. ejecutar un Preflight y validar AEAT TEST antes de activar automatismos.

## Contrato KFS2

KFS2 es un código de activación de un solo uso. **No contiene el bearer data-plane**.

```text
Kairoseth / operador autorizado
        ↓
POST onboarding/profiles
        ↓ nativeConnector=woocommerce
POST materialize-integration
        ↓
PUT IntegrationProfile/mapping
        ↓
crear KFS2 para siteUrl concreta
        ↓
MongoDB guarda solo SHA-256 + TTL
        ↓
cliente pega KFS2 en WordPress
        ↓
POST /v1/customer-activation/exchange
        ↓
consumo atómico del código
        ↓
crear credencial data-plane scoped
        ↓
WordPress guarda la credencial
```

La clave KFS2:

- usa 256 bits aleatorios;
- se liga a la URL HTTPS de la tienda;
- caduca a los 15 minutos;
- se persiste únicamente como SHA-256;
- se puede canjear una sola vez;
- no permite rutas privilegiadas del control-plane.

El endpoint público de canje es únicamente `POST /v1/customer-activation/exchange`. Tiene límite de tamaño y rate limit antes del canje. El resto de `/v1/*` conserva la autenticación normal.

## Emisor operativo

El comando interno KFS2 es:

```bash
export MONGODB_URI='<KAIROSETH_MONGODB_ATLAS_URI>'
export MONGODB_DB_NAME='kairoseth'

printf '%s' "$KAIROSETH_CONTROL_TOKEN" | \
  node scripts/ops/woocommerce-one-time-activation-issuer.mjs \
  --mapping /private/kairoseth-fiscal/mappings/cliente-woocommerce.json \
  --site-url 'https://tienda-del-cliente.example' \
  --label 'Tienda del cliente'
```

El token de control-plane entra por `stdin`; nunca se pasa como argumento de proceso. MongoDB y el mapping son recursos internos de Kairoseth: el cliente no los ve ni los configura.

`stdout` contiene únicamente la KFS2 mostrada una vez. `stderr` contiene identificadores operativos sanitizados y la caducidad para trazabilidad.

## Compatibilidad KFS1

KFS1 queda temporalmente soportado por el plugin para instalaciones ya emitidas, pero **no es el flujo de nuevas altas**. KFS1 transporta una credencial data-plane scoped dentro de la propia clave y debe retirarse cuando no queden activaciones pendientes de la versión anterior.

No deben emitirse nuevas KFS1 con `scripts/ops/woocommerce-activation-issuer.mjs` salvo recuperación controlada de una instalación legacy.

## Mapping y autoridad fiscal

El mapping es responsabilidad de Kairoseth y se prepara antes de emitir KFS2. El emisor:

- fuerza `MappingProfile.id` al `IntegrationProfile` creado por Kairoseth;
- exige `sourceType=native`;
- rechaza placeholders `CONFIGURE...`;
- no acepta mapping fiscal enviado desde WordPress.

El fichero de mapping puede contener datos fiscales del cliente y debe permanecer fuera de Git y de `public_html`.

El plugin no selecciona R1–R5 ni S/I y no controla certificados, XML AEAT, cadena de huellas ni entorno productivo. Esa autoridad permanece server-side.

## Contrato comercial de onboarding

La conexión, diagnóstico, Preflight y validación en **AEAT TEST** forman parte del onboarding gratuito. La conexión inicial debe quedar en `test`.

El paso a **AEAT producción** requiere un plan comercial activo. Para WooCommerce estándar corresponde **Fiscal Connect — 49 €/mes**. El pago no es requisito para TEST y el cliente no dispone de un interruptor local para habilitar producción.

## Criterio de aceptación

Una instalación WooCommerce se considera correctamente onboarded cuando un usuario normal puede instalar el ZIP, introducir KFS2, quedar conectado sin conocer infraestructura interna, seleccionar su numeración, ejecutar Preflight y comprobar AEAT TEST. Hostinger, MongoDB, hashes, perfiles internos y credenciales administrativas no forman parte del flujo del cliente.
