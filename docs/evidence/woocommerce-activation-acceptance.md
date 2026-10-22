# WooCommerce customer activation — acceptance criteria

La activación de Kairoseth Fiscal para WooCommerce solo se considera lista cuando se demuestra el siguiente recorrido sin configuración técnica en WordPress:

```text
Kairoseth emite activación
→ cliente instala plugin
→ cliente introduce una única clave KFS1
→ plugin queda conectado al endpoint oficial
→ cliente configura numeración fiscal
→ pedido WooCommerce
→ preflight manual válido
→ envío TEST controlado
→ estado fiscal visible en WooCommerce
```

## Gates

- El control-plane administrativo no se entrega al cliente.
- El `IntegrationProfile` se deriva del onboarding, no de un ID elegido por WordPress.
- El mapping se instala server-side y no contiene placeholders.
- La credencial data-plane es específica de la integración y se muestra una sola vez durante el alta.
- La clave KFS1 fija el endpoint oficial de Kairoseth Fiscal.
- Los automatismos permanecen desactivados hasta superar preflight.
- Rectificativas/reembolsos permanecen fuera del primer acceptance hasta validar su perfil independiente.
- La compatibilidad debe probarse contra la versión WooCommerce usada en el laboratorio antes de declararla soportada.

Este documento no autoriza AEAT producción. El acceptance inicial se ejecuta en el entorno fiscal TEST configurado por Kairoseth.
