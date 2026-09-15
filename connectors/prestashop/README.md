# Puente VeriFactu — PrestaShop connector v1

Conector nativo y deliberadamente fino para **PrestaShop 1.7.8.x y 8.x**. Su trabajo es extraer datos de una factura/pedido, construir un payload neutral y hablar con la API universal de Puente VeriFactu. **No contiene reglas AEAT, XML, SOAP, certificados ni decisiones fiscales sensibles.**

## Estado

Foundation v1 implementada en modo manual seguro:

- configuración por tienda para endpoint HTTPS y `MappingProfile` server-side;
- Bearer token cifrado localmente con AES-256-GCM usando una clave derivada de `_COOKIE_KEY_`;
- payload neutral de pedido/factura con número fiscal nativo, fecha, moneda, destinatario, totales y desglose por tipos;
- soporte de moneda extranjera delegando la conversión fiscal EUR al servidor;
- flujo manual `preflight -> issue -> reconcile` desde la configuración del módulo;
- idempotencia estable por tienda + pedido + número de factura;
- persistencia local mínima de `recordId`, estado y último error;
- aislamiento básico multitienda;
- gate CI contractual y sintaxis PHP 7.4.

Todavía **no** activa envíos automáticos ni rectificativas. Eso se añade después de validar esta base y la matriz real PrestaShop.

## Principio de seguridad

PrestaShop nunca recibe el certificado AEAT. El certificado y la clave privada permanecen únicamente en el runtime seguro de Puente VeriFactu.

El módulo tampoco decide `invoiceType`, `taxCode`, `regimeKey`, `operationClass`, datos del emisor ni criterios de conversión fiscal. Todo ello pertenece al `MappingProfile` y a la configuración server-side.

## Requisitos

- PrestaShop >= 1.7.8 y < 9.0 para esta primera matriz contractual.
- PHP 7.4+ para el gate inicial del repositorio.
- extensiones PHP OpenSSL y cURL.
- endpoint Puente VeriFactu accesible mediante HTTPS.
- token Bearer y `MappingProfile` configurados en el servidor.
- la factura de PrestaShop debe tener `invoice_number` e `invoice_date` antes de fiscalizarla.

## Instalación de desarrollo

Copia `connectors/prestashop` como módulo `puenteverifactu` dentro de `modules/puenteverifactu/` y actívalo desde el gestor de módulos.

En **Configurar** introduce:

1. endpoint HTTPS del bridge;
2. ID del `MappingProfile`;
3. token Bearer;
4. timeout.

El token no vuelve a mostrarse después de guardarlo.

## Flujo manual v1

En el panel del módulo introduce el ID de pedido:

1. **Preflight only**: transforma y valida, sin crear registro fiscal ni enviar a AEAT.
2. **Create fiscal record**: vuelve a ejecutar preflight y, solo si pasa, crea el registro mediante `/v1/fiscal-records` con `Idempotency-Key`.
3. **Refresh status**: consulta `/v1/fiscal-records/{recordId}`.

Si ya existe `recordId`, el módulo bloquea la creación duplicada y obliga a reconciliar.

## Payload neutral

Ejemplo abreviado:

```json
{
  "connector_schema": 1,
  "source_invoice_id": "prestashop:1:order:123",
  "order_id": "123",
  "order_reference": "ABCDXYZ",
  "invoice_number": "#FA123",
  "order_date": "2026-09-15",
  "currency": "EUR",
  "customer_name": "Cliente SL",
  "customer_tax_id": "B12345678",
  "total_amount": "121.00",
  "tax_lines": [
    { "rate": "21", "baseAmount": "100.00", "taxAmount": "21.00" }
  ]
}
```

El perfil de referencia está en `examples/mapping-profile.json`.

## Límites conocidos de la foundation

- no se fiscalizan automáticamente cambios de estado;
- no se procesan todavía abonos/rectificativas;
- no hay todavía semáforo dentro de la ficha nativa del pedido;
- la matriz real de CI con instalaciones PrestaShop se incorpora en el siguiente gate;
- promociones complejas que alteren el reparto fiscal deben pasar siempre por preflight y pueden quedar bloqueadas hasta ampliar el extractor;
- PrestaShop 9 se evaluará explícitamente en la matriz antes de declararlo compatible.

## Siguiente incremento

1. fixture contractual de descuentos/envío/impuestos múltiples;
2. compatibilidad real 1.7.8.x / 8.x en CI;
3. integración del estado en la ficha de pedido;
4. rectificativas/abonos idempotentes;
5. automatización opt-in después de validar el flujo manual.
