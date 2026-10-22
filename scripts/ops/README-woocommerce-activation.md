# WooCommerce activation quickstart

Uso interno de Kairoseth. No entregar este procedimiento al cliente final.

```bash
printf '%s' "$KAIROSETH_CONTROL_TOKEN" | \
  node scripts/ops/woocommerce-activation-issuer.mjs \
  --mapping /private/kairoseth-fiscal/mappings/cliente-woocommerce.json \
  --label "Nombre de la tienda"
```

La clave `KFS1...` se muestra una sola vez por stdout y es lo único que necesita recibir el cliente para conectar el plugin.

No usar `connectors/woocommerce/examples/mapping-profile.json` directamente: contiene placeholders y el emisor los rechaza de forma explícita.
