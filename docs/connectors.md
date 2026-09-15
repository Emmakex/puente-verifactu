# Conectores y adaptadores

## Objetivo

Permitir que cualquier sistema pueda usar el núcleo sin copiar lógica fiscal.

## Contrato obligatorio de un conector

Un conector debe:

1. Detectar el momento correcto en el que una factura queda expedida/finalizada.
2. Generar un `sourceInvoiceId` estable.
3. Mapear datos del origen al modelo canónico.
4. Enviar una sola intención lógica aunque la red reintente.
5. Persistir la relación `sourceInvoiceId <-> recordId`.
6. Mostrar estado al operador sin convertir un fallo temporal en factura duplicada.
7. Permitir reconciliación manual segura.
8. Nunca editar localmente el historial fiscal del puente.

## Lo que un conector no puede hacer

- Construir XML AEAT por su cuenta.
- Elegir endpoint AEAT arbitrariamente.
- Acceder a certificados de otra organización.
- Concederse roles o permisos desde el navegador.
- Decidir que un rechazo AEAT equivale a aceptación.
- Reenviar creando un nuevo registro cuando corresponda reintentar el mismo.

## Adaptadores previstos

Orden orientativo:

1. Adaptador de referencia / SDK genérico.
2. WordPress + WooCommerce.
3. PrestaShop.
4. API REST genérica para ERP/CRM/software propio.
5. Webhooks/importadores específicos de ERPs prioritarios según demanda.

## WordPress/WooCommerce

El plugin será una **capa cliente** de Puente VeriFactu, no el motor regulatorio completo. Debe permanecer ligero, compatible con colas/reintentos de WooCommerce y sin secretos AEAT expuestos al navegador.

## Certificación de conectores

Cada adaptador debe pasar una suite contractual común con casos: alta, duplicado, corrección, rechazo, timeout, reintento, pérdida de conexión, datos incompletos, moneda/decimales y recuperación tras caída.
