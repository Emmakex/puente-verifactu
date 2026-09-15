# Onboarding universal

## Objetivo

Que una persona autónoma o pyme pueda determinar en pocos pasos cómo conectar su sistema sin conocer APIs, XML, certificados o terminología interna de AEAT.

## Flujo

### Paso 1 — Tu negocio

Recoger solo la información necesaria de organización y configuración fiscal. Los campos avanzados se muestran únicamente cuando aplican.

### Paso 2 — ¿Cómo facturas hoy?

Opciones comprensibles:

- programa/ERP;
- tienda online;
- WordPress/WooCommerce;
- PrestaShop;
- Excel/CSV;
- software a medida;
- otro/no lo sé.

### Paso 3 — Detección de capacidades

El asistente determina si existe plugin, API, webhook, exportación de archivo o entrada manual. Debe recomendar la opción más automática disponible manteniendo siempre una alternativa universal.

### Paso 4 — Prueba sin riesgo

Importar o recibir datos de ejemplo y ejecutar `preflight`. Nada se remite a AEAT.

### Paso 5 — Correcciones guiadas

Mostrar tres categorías: obligatorio, recomendable y advertencia. Cada error indica dónde corregirlo: sistema origen, mapping o configuración del puente.

### Paso 6 — Activación

Confirmación explícita. Registrar quién activó, qué versión del conector/mapping y qué configuración estaba vigente.

### Paso 7 — Semáforo operativo

La interfaz para cliente debe reducir el estado a señales claras:

- Verde: funcionando y sincronizado.
- Ámbar: pendiente/reintentando; no crear duplicados.
- Rojo: requiere acción.

El detalle técnico queda disponible para soporte/desarrolladores sin obligar al usuario final a interpretarlo.

## Regla de fallback

Toda integración nativa debe tener una vía de contingencia documentada, preferentemente archivo universal, para evitar que una actualización del ERP bloquee completamente la operativa.
