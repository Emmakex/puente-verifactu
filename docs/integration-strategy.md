# Estrategia de integración camaleónica

## Regla de producto

Puente VeriFactu no se vende como «otro programa de facturación». Se diseña como una **capa de compatibilidad fiscal** que se adapta al flujo actual del autónomo o pyme.

La integración se decide por las capacidades reales del sistema origen, no por su marca.

## Los cinco niveles

### Nivel 0 — Manual asistido

Para negocios sin integración técnica. Un asistente permite introducir o revisar datos y ver errores antes de fiscalizar. Debe minimizar campos y reutilizar configuración recurrente.

### Nivel 1 — Archivo

CSV es obligatorio como formato universal. Excel/XLSX se incorporará mediante importador. El usuario mapea columnas una vez y guarda un `MappingProfile` reutilizable. Debe existir vista previa, validación y simulación antes del envío.

### Nivel 2 — Webhook / low-code

Para herramientas que pueden lanzar HTTP pero no implementar un SDK completo. Un endpoint de entrada admite payload simple y un perfil de transformación versionado.

### Nivel 3 — API / SDK universal

Contrato canónico REST y SDKs para desarrolladores. El integrador trabaja con conceptos de factura, no con XML, WSDL o detalles de AEAT.

### Nivel 4 — Conector nativo

Plugins/módulos específicos para plataformas con volumen suficiente: WooCommerce, PrestaShop y otros sistemas. Deben permanecer clientes ligeros del núcleo.

## Capability Discovery

El onboarding pregunta:

- ¿Dónde emites hoy las facturas?
- ¿Puedes exportar CSV/Excel?
- ¿El sistema tiene API?
- ¿Puede enviar webhooks/HTTP?
- ¿Podemos instalar plugin/módulo?
- ¿Necesitas funcionamiento manual de respaldo?

A partir de las respuestas se selecciona automáticamente la ruta menos invasiva.

## MappingProfile

Un perfil de mapeo traduce el vocabulario del cliente al contrato canónico. Debe ser versionado, validable y portable.

Ejemplo conceptual:

```json
{
  "profileVersion": 1,
  "source": "generic-csv",
  "fields": {
    "invoice_number": "number",
    "invoice_date": "issueDate",
    "customer_tax_id": "recipient.taxId",
    "total": "totals.total"
  }
}
```

Los perfiles no pueden alterar invariantes fiscales ni conceder permisos.

## Preflight obligatorio

Antes de activar una integración:

1. conectar/importar una muestra;
2. mapear campos;
3. ejecutar validación sin efectos;
4. mostrar datos faltantes con lenguaje comprensible;
5. corregir el mapping;
6. ejecutar casos de prueba;
7. activar el flujo real explícitamente.

Nunca se aprende un mapping «en producción» enviando registros reales a AEAT.

## Portabilidad

El cliente debe poder cambiar de ERP o ecommerce sin perder su configuración fiscal. La identidad de organización, historial, credenciales y estado pertenecen al puente; la integración es reemplazable.

## UX

Los errores técnicos se traducen a acciones. Ejemplo: en vez de `VF_VALIDATION_RECIPIENT_002`, la interfaz puede mostrar «Falta el NIF del cliente en la columna Cliente NIF» manteniendo el código técnico para soporte.
