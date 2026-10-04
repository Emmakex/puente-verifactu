# File import connector

Ruta universal para autónomos y pymes sin API.

CSV y XLSX terminan en el mismo `MappingProfile`, el mismo preflight y el mismo motor fiscal. El formato de archivo no crea una implementación VERI*FACTU distinta.

## Inspección asistida

```bash
node connectors/file-import/src/cli.mjs --file mi-archivo.csv --infer
node connectors/file-import/src/cli.mjs --file mi-archivo.xlsx --infer
```

Para XLSX se puede seleccionar hoja y fila de cabecera:

```bash
node connectors/file-import/src/cli.mjs --file mi-archivo.xlsx --sheet Facturas --header-row 3 --infer
```

La respuesta indica:

- columnas detectadas automáticamente;
- sugerencias que requieren revisión;
- columnas sin identificar;
- campos esenciales pendientes;
- configuración fija de empresa pendiente;
- borrador de `MappingProfile`.

La inferencia nunca envía datos ni activa producción.

## Preflight

Una vez confirmado el perfil:

```bash
node connectors/file-import/src/cli.mjs --file mi-archivo.csv --profile mapping.json
node connectors/file-import/src/cli.mjs --file mi-archivo.xlsx --sheet Facturas --profile mapping.json
```

El preflight es siempre sin efectos.

## CSV

Detecta `;`, `,` y tabulador, soporta campos entrecomillados y transforma fechas/decimales habituales mediante el perfil.

Smoke del repositorio:

```bash
npm run preflight:demo
npm run mapping:demo
```

## XLSX

El lector XLSX es read-only y no tiene dependencias externas. Soporta las estructuras habituales necesarias para importar facturas: múltiples hojas, shared strings, inline strings, números, valores cacheados de fórmulas y fechas Excel.

Aplica límites defensivos de tamaño, filas, columnas y entradas ZIP; no extrae archivos al filesystem y rechaza DTD/ENTITY. `.xls` antiguo debe convertirse previamente a `.xlsx` o CSV.

## Principio Camaleón

El negocio no tiene que cambiar su Excel para adaptarse a Puente VeriFactu. El asistente propone cómo traducir las columnas existentes y el usuario solo confirma las equivalencias dudosas y completa los datos fiscales que no estén en el archivo.


## Flujo durable Kairoseth

En Kairoseth productivo, CSV/XLSX utiliza una confirmación explícita antes de cualquier efecto fiscal:

```text
POST /v1/imports/inspect
  -> POST /v1/imports/{importId}/preflight
  -> POST /v1/imports/{importId}/confirm
  -> POST /v1/import-batches/{batchId}/issue
  -> GET  /v1/import-batches/{batchId}
  -> GET  /v1/import-batches/{batchId}/export
```

Reglas:

- `inspect` y `preflight` no emiten nada;
- `confirm` solo crea el batch si **todas** las filas pasan preflight;
- la confirmación congela el `InvoiceIntent` exacto de cada fila;
- el batch confirmado se persiste en MongoDB Kairoseth, aislado por organización + instalación;
- el binario CSV/XLSX original no se guarda en MongoDB;
- cada fila usa una `Idempotency-Key` estable derivada de `importId + row`;
- la emisión adquiere un lease para impedir dos workers sobre el mismo batch;
- una caída tras fiscalizar y antes de guardar el resultado se recupera reutilizando la misma idempotencia;
- fallos retryable pueden reanudarse; fallos no retryable no se reintentan automáticamente;
- el resultado público nunca devuelve el `InvoiceIntent` congelado ni XML/SOAP AEAT;
- el export soporta JSON y `Accept: text/csv`.

La antigua ruta directa `POST /v1/imports/{importId}/issue` queda bloqueada con
`VF_IMPORT_CONFIRMATION_REQUIRED`; la confirmación es obligatoria.
