# Activación de cliente WooCommerce — Kairoseth Fiscal

## Objetivo

El cliente de WooCommerce no configura endpoints, `IntegrationProfile`, `MappingProfile`, tokens administrativos, MongoDB ni credenciales AEAT.

La superficie de cliente se limita a:

1. instalar **Kairoseth Fiscal for WooCommerce**;
2. obtener una clave de conexión emitida por Kairoseth;
3. pegarla en el plugin y pulsar **Conectar**;
4. elegir la fuente real del número de factura;
5. ejecutar un preflight antes de activar automatismos.

## Autoridad

La activación se emite desde Kairoseth usando una credencial interna con `onboarding:manage`. Esa credencial nunca se entrega a WordPress ni se incorpora al ZIP.

El emisor reutiliza el control-plane existente:

```text
Kairoseth / operador autorizado
        ↓
POST onboarding/profiles
        ↓ nativeConnector=woocommerce
POST materialize-integration
        ↓
PUT IntegrationProfile/mapping
        ↓
POST IntegrationProfile/credential
        ↓ token data-plane mostrado una vez
KFS1.<payload>
        ↓
WordPress / WooCommerce
```

La credencial incluida en KFS1 queda limitada al `IntegrationProfile` creado para esa tienda. No puede utilizar rutas privilegiadas del control-plane.

## Emisor operativo

El comando interno es:

```bash
printf '%s' "$KAIROSETH_CONTROL_TOKEN" | \
  node scripts/ops/woocommerce-activation-issuer.mjs \
  --mapping /private/kairoseth-fiscal/mappings/cliente-woocommerce.json \
  --label "Tienda del cliente"
```

El token de control-plane entra por `stdin`; nunca se pasa como argumento de proceso.

`stdout` contiene únicamente la clave KFS1 que se entrega al cliente. Los identificadores operativos sanitizados se escriben en `stderr` para trazabilidad.

## Mapping

El mapping es responsabilidad de Kairoseth y se prepara antes de emitir la activación. El emisor:

- fuerza `MappingProfile.id` al `IntegrationProfile` creado por Kairoseth;
- exige `sourceType=native`;
- rechaza placeholders `CONFIGURE...`;
- no acepta mapping fiscal enviado desde WordPress.

El fichero de mapping utilizado por el operador puede contener datos fiscales del cliente y por ello debe permanecer fuera de Git y de `public_html`.

## Estado inicial

La activación WooCommerce v1 cubre facturas ordinarias. Los reembolsos/rectificativas siguen desactivados hasta que exista y se valide un perfil correctivo independiente.

El plugin no selecciona R1–R5 ni S/I. Esa autoridad permanece en Kairoseth.

## Evolución de producto

Este emisor es la operación backend reutilizable. Kairoseth Platform podrá invocarlo detrás de un botón de alta sin cambiar el contrato del plugin.

La evolución posterior puede sustituir la clave KFS1 por un canje de código de un solo uso o un flujo browser/OAuth. En todos los casos se mantienen las mismas reglas:

- ningún secreto administrativo en WordPress;
- credencial data-plane por integración;
- mapping y fiscalidad server-side;
- preflight antes de emisión automática.
