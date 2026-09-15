# File import connector

Ruta universal para autónomos y pymes sin API.

## CSV v1

```bash
npm run preflight:demo
```

El flujo detecta delimitador, aplica `MappingProfile`, transforma fechas/decimales habituales y ejecuta preflight sin efectos. También puede sugerir un mapping inicial:

```bash
node connectors/file-import/src/cli.mjs --csv mi-archivo.csv --infer
```

La inferencia nunca envía datos ni activa producción. XLSX se añadirá encima del mismo contrato canónico.
