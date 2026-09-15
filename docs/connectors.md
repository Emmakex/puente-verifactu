# Conectores y adaptadores

## Objetivo

Permitir que cualquier sistema use el núcleo sin copiar lógica fiscal y sin obligar al cliente a sustituir su herramienta actual.

## Canales soportados como arquitectura

1. manual asistido;
2. CSV/Excel mediante mapping reutilizable;
3. webhook/HTTP low-code;
4. REST/SDK genérico;
5. plugin/módulo/conector nativo.

## Contrato obligatorio

Un conector/adaptador debe:

1. identificar una operación de origen de forma estable;
2. mapear datos al contrato canónico o producir un candidato de preflight;
3. usar idempotencia;
4. persistir la relación origen ↔ registro cuando aplique;
5. exponer estado comprensible;
6. permitir reconciliación segura;
7. declarar versión y capacidades;
8. ofrecer estrategia de fallback cuando sea razonable.

## Prohibiciones

- Construir XML AEAT por su cuenta.
- Elegir endpoints AEAT arbitrariamente.
- Acceder a certificados de otra organización.
- Conceder roles/permisos desde cliente.
- Convertir rechazo en aceptación.
- Crear otro registro cuando lo correcto es reintentar el existente.
- Modificar un mapping activo silenciosamente.

## Prioridad de adaptadores

1. `reference`: especificación ejecutable del contrato.
2. `file-import`: CSV primero; XLSX posteriormente.
3. WordPress + WooCommerce.
4. PrestaShop.
5. REST/webhook universal.
6. ERP/CRM prioritarios según demanda real.

## Conectores nativos

Son capas cliente ligeras. Deben capturar el evento correcto del sistema origen, mapear datos y mostrar estado. La lógica fiscal, credenciales AEAT y transporte oficial permanecen en el puente.

## Suite contractual

Todos los canales deben pasar los mismos escenarios relevantes: alta, duplicado, corrección, rechazo, timeout, reintento, caída, datos incompletos, decimales, recuperación y cambio de mapping.
