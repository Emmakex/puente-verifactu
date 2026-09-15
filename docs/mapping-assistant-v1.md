# Mapping Assistant v1

## Objetivo

Permitir que un autónomo o pyme conecte el archivo que ya utiliza sin conocer `InvoiceIntent`, XML AEAT ni nombres internos de campos.

El asistente trabaja sobre CSV y XLSX y nunca fiscaliza ni envía nada a AEAT. Su única función es inspeccionar, proponer y validar un `MappingProfile` reutilizable.

## Flujo de usuario

```text
1. Cargar CSV/XLSX
2. Elegir hoja (si hay varias)
3. Detectar cabeceras y muestras
4. Proponer equivalencias
5. Confirmar/revisar campos dudosos
6. Completar configuración fija del negocio
7. Ejecutar preflight sin efectos
8. Guardar MappingProfile
```

## Estados de sugerencia

Cada propuesta devuelve un nivel de confianza:

- `auto`: coincidencia suficientemente fuerte para incorporarla al borrador automáticamente;
- `review`: sugerencia razonable que requiere confirmación humana;
- sin sugerencia: la columna queda como `unmatched`.

Una señal basada solo en valores nunca es suficiente para mapear una columna. Primero debe existir similitud semántica de cabecera; las muestras únicamente pueden aumentar la confianza de una propuesta ya plausible.

## Ejemplo de experiencia

Archivo del cliente:

| Columna origen | Propuesta | Estado |
|---|---|---|
| Nº Factura | Número de factura | Automático |
| Fecha factura | Fecha de expedición | Automático |
| CIF Cliente | NIF destinatario | Automático |
| Base imponible | Base | Automático |
| IVA | Cuota IVA | Revisar si es ambiguo |
| Observaciones internas | — | Sin usar |

La UI futura debe mostrar estados visuales comprensibles, nunca rutas internas como `taxBreakdown.0.taxAmount` como etiqueta principal.

## Configuración fija

Algunos datos normalmente no vienen en cada fila y se solicitan una sola vez para el perfil:

- nombre/razón social del emisor;
- NIF del emisor;
- moneda;
- impuesto;
- clave de régimen;
- clasificación de operación.

Estos datos se guardan como `constants` del `MappingProfile`. El usuario no debe repetirlos en cada factura.

## Contrato ejecutable

`packages/core/src/mapping-assistant.mjs` expone:

- `suggestMapping(headers, options)`;
- `acceptMappingSuggestions(report, acceptedSources)`;
- `ESSENTIAL_MAPPING_TARGETS`;
- `CONFIGURATION_TARGETS`.

La respuesta incluye:

- `suggestions` con `confidence`, `status` y motivos;
- `unmappedHeaders`;
- `missingEssentialTargets`;
- `missingConfiguration`;
- un `profile` borrador con solo mappings `auto`;
- `safeToPreflight` cuando no queda ninguna confirmación/configuración imprescindible pendiente.

Las sugerencias `review` nunca se incorporan al perfil sin aceptación explícita.

## XLSX

El lector XLSX de `connectors/file-import/src/xlsx.mjs` es read-only y no depende de paquetes externos.

Soporta para el flujo de facturación habitual:

- múltiples hojas;
- `sharedStrings`;
- `inlineStr`;
- números;
- booleanos;
- valor cacheado de fórmulas, sin ejecutar fórmulas;
- fechas Excel mediante estilos habituales;
- selección de hoja y fila de cabecera.

Límites defensivos:

- máximo 512 entradas ZIP;
- máximo 25 MiB descomprimidos por workbook;
- máximo 10 MiB por entrada;
- máximo 256 columnas;
- máximo 10.000 filas por defecto;
- ZIP64/multidisk/encriptado no soportados;
- DTD/ENTITY rechazados;
- ningún archivo se extrae al filesystem.

`.xls` binario antiguo queda fuera: el usuario debe guardarlo como `.xlsx` o CSV.

## CLI

Inspección sin efectos:

```bash
node connectors/file-import/src/cli.mjs --file facturas.xlsx --infer
```

Hoja concreta:

```bash
node connectors/file-import/src/cli.mjs --file facturas.xlsx --sheet Facturas --infer
```

Preflight con perfil confirmado:

```bash
node connectors/file-import/src/cli.mjs --file facturas.xlsx --sheet Facturas --profile mapping.json
```

CSV usa exactamente el mismo flujo.

## Principio de seguridad

El asistente puede facilitar la integración, pero nunca inventa silenciosamente una decisión fiscal. Si no puede determinar un campo con confianza, pide confirmación. La facilidad de uso no desplaza la autoridad del motor fiscal ni la configuración server-side.
