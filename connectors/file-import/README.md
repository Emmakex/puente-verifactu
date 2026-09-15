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
