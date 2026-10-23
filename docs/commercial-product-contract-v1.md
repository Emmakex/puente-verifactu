# Contrato comercial de VeriFactu Software v1

## 1. Autoridad

Este documento fija el contrato comercial y de producto aprobado para la distribución de **VeriFactu Software** sobre el motor técnico **Puente VeriFactu**.

Es la fuente de verdad para alinear:

- `kairoseth.com`;
- el plugin de WordPress/WooCommerce;
- WordPress.org y otros canales de distribución;
- Kairoseth Platform;
- onboarding, entitlements y activación de AEAT producción.

El nombre técnico del repositorio y del motor no cambia. Las rutas históricas `/products/kairoseth-fiscal/...` pueden conservarse para no romper SEO/enlaces; el nombre visible al cliente es **VeriFactu Software**.

## 2. Principio comercial

El plugin/conector es la puerta de entrada y puede instalarse sin pago. El valor de pago comienza cuando el cliente necesita operar fiscalmente en **AEAT producción**.

Regla resumida:

```text
Descubrir              -> gratis
Instalar plugin        -> gratis
Comprobar/preflight    -> gratis
Conectar Kairoseth     -> gratis
AEAT TEST onboarding   -> gratis y limitado
AEAT producción        -> requiere plan ACTIVE
```

La descarga del plugin no es el producto de pago. El servicio fiscal gestionado, su operación en producción y los derechos asociados sí lo son.

## 3. Funnel de cliente

```text
Google / kairoseth.com / WordPress.org / partner
                         ↓
                 Instalar conector
                         ↓
              Comprobar mi tienda/sistema
                         ↓
             Preflight sin envío a AEAT
                         ↓
              Conectar con Kairoseth
                         ↓
          Onboarding + credencial scoped
                         ↓
              AEAT TEST controlado
                         ↓
              Activar producción 🔒
                         ↓
                    Plan ACTIVE
                         ↓
          Operación fiscal en producción
```

El cliente no debe configurar URLs internas, hashes, credenciales administrativas, `auth.json`, certificados del runtime ni secretos de infraestructura.

## 4. Qué es gratuito

### 4.1 Plugin/conector

- descarga e instalación;
- pantalla de estado;
- configuración básica local;
- conexión con Kairoseth mediante flujo de onboarding seguro.

### 4.2 Diagnóstico y preflight

Debe poder comprobarse la integración antes de contratar producción:

- estructura del pedido/factura;
- numeración seleccionada;
- datos mínimos;
- impuestos/totales;
- mapping;
- compatibilidad básica del origen;
- errores corregibles.

El preflight **no envía a AEAT**.

### 4.3 AEAT TEST de onboarding

Puede incluirse una validación técnica limitada en entorno de pruebas para verificar el circuito extremo a extremo.

No equivale a presentación fiscal real y debe mostrarse claramente como **Entorno de pruebas (AEAT TEST)**.

## 5. Dónde empieza el pago

El pago empieza al solicitar **AEAT producción**.

La activación de producción requiere simultáneamente:

1. organización/cliente correctamente identificado;
2. integración materializada y saludable;
3. configuración fiscal necesaria;
4. requisitos de certificado/representación cuando correspondan;
5. gate técnico/regulatorio superado;
6. entitlement comercial `ACTIVE`.

Billing nunca debe saltarse el gate fiscal. El gate fiscal tampoco debe conceder por sí solo derechos comerciales.

## 6. Estados comerciales mínimos

### FREE

Permite:

- instalación;
- conexión;
- diagnóstico/preflight;
- onboarding;
- AEAT TEST limitado.

Bloquea:

- nuevos envíos a AEAT producción.

### ACTIVE

Permite, según modalidad/entitlements:

- AEAT producción;
- envío manual o automático;
- seguimiento/reconciliación;
- rectificativas/anulaciones soportadas;
- histórico operativo;
- soporte y capacidades contratadas.

### SUSPENDED

Conserva, según obligaciones legales y de producto:

- histórico y consulta autorizada;
- trazabilidad existente.

Bloquea:

- nuevas operaciones de producción hasta reactivación.

Los futuros planes comerciales (Autónomo, Pyme, Profesional, Partner, volumen, etc.) deben mapearse a entitlements sin introducir lógica de precios dentro del plugin.

## 7. Regla para el plugin

La interfaz normal debe hablar en términos humanos:

```text
VeriFactu Software

Estado: No conectado
[ Conectar con VeriFactu Software ]

Comprobación
[ Comprobar mi tienda gratis ]

Entorno
Pruebas / Producción

Estado fiscal
Pendiente / Validado / Enviado / Error
```

Los campos técnicos quedan ocultos en flujo normal y, si son necesarios para soporte, se sitúan en una sección avanzada.

El plugin jamás recibe una credencial administrativa/control-plane. Solo recibe una credencial **data-plane scoped** para su integración.

## 8. Onboarding objetivo

El flujo objetivo es:

1. cliente instala el plugin;
2. pulsa `Conectar con VeriFactu Software`;
3. inicia sesión o introduce una clave/código de activación de un solo uso;
4. Kairoseth valida la sesión/código;
5. Kairoseth crea o resuelve organización e instalación;
6. materializa `IntegrationProfile` y mapping;
7. genera credencial scoped de la integración;
8. el plugin recibe únicamente la configuración mínima y la credencial scoped;
9. ejecuta health check/preflight;
10. muestra estado listo para TEST o siguiente acción.

El código de activación, si se usa, debe ser de un solo uso, con TTL, ligado al cliente/integración/sitio, almacenado de forma segura e idempotente en el canje.

## 9. Regla de AEAT producción

Producción permanece **fail-closed**.

Ningún CTA comercial, instalación del plugin, prueba gratuita, pago, alta de cuenta o resultado de preflight puede activar por sí solo AEAT producción.

La capacidad de producir envíos reales debe derivarse de:

```text
plan ACTIVE
AND
fiscal_gate = approved
AND
runtime_production_gate = enabled
```

## 10. Pricing y cobro

Los importes concretos siguen fuera de este contrato hasta cerrar unit economics.

Stripe/Redsys no son requisito para iniciar ventas. Mientras billing automático esté aplazado, una contratación validada puede activar manualmente el entitlement `ACTIVE` desde Kairoseth Platform tras el proceso comercial correspondiente.

Cuando exista checkout, automatizará el cambio de entitlement; no cambiará el contrato del plugin ni el core fiscal.

## 11. Coherencia de canales

Deben prometer lo mismo:

### kairoseth.com

- instalar/probar sin cambiar de sistema;
- comprobar gratis;
- TEST antes de producción;
- producción sujeta a activación/plan.

### WordPress.org

- plugin gratuito;
- funcionalidad útil gratuita real;
- explicación transparente de que el servicio de producción requiere cuenta/plan de Kairoseth;
- sin promesas de certificación inexistente.

### Plugin WooCommerce

- onboarding sencillo;
- preflight gratis y explícitamente sin AEAT;
- TEST claramente identificado;
- producción bloqueada hasta entitlement/gate.

### Kairoseth Platform

- fuente de verdad de cuenta, entitlement, onboarding y estado;
- activación, suspensión, rotación/revocación y soporte;
- histórico y observabilidad.

## 12. Regla de cambio

Cualquier cambio futuro en:

- frontera gratis/pago;
- nombre comercial visible;
- entitlement de producción;
- funnel;
- onboarding;
- política de TEST;
- pricing/checkout;

debe actualizar este documento y la arquitectura comercial de `Emmakex/kairoseth-platform` en el mismo cambio o en cambios coordinados.