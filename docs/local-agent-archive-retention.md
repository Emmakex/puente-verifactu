# Local Agent Archive Retention v1

## Objetivo

Definir una política explícita y segura para los archivos fuente archivados por el Local Agent en `processed/` y `error/`, sin confundir retención de ficheros con la minimización de payloads de SQLite.

## Regla por defecto

La configuración por defecto es:

```json
{
  "archiveRetention": {
    "mode": "keep"
  }
}
```

`keep` significa **sin borrado automático**. Actualizar o instalar una nueva versión del agente no activa una poda implícita.

## Poda opt-in

El operador puede activar una política por antigüedad:

```json
{
  "archiveRetention": {
    "mode": "delete-source-after-days",
    "processedDays": 30,
    "errorDays": 90
  }
}
```

Ambos plazos son obligatorios, enteros y deben estar entre 1 y 3650 días.

La antigüedad se calcula a partir del timestamp del manifest/recibo generado por el propio agente, no desde el `mtime` del fichero.

## Qué se elimina

La poda automática puede eliminar únicamente el **CSV/XLSX bruto archivado** cuando:

1. está en `processed/` o `error/`;
2. tiene extensión soportada `.csv` o `.xlsx`;
3. existe un manifest o recibo reconocido junto al archivo;
4. la metadata contiene un timestamp válido;
5. ha transcurrido el plazo configurado para esa categoría.

## Qué nunca elimina esta política

La política v1 no elimina automáticamente:

- ficheros de `inbox/`;
- ficheros de `processing/`;
- archivos sin metadata reconocida;
- `.pv-manifest.json`;
- `.pv-error.json`;
- registros SQLite de idempotencia/trazabilidad;
- backups del agente;
- archivos remotos SFTP del sistema origen.

Los manifests/recibos sanitizados permanecen para conservar trazabilidad operativa aunque el fichero comercial bruto haya sido eliminado.

## Watch-folder y SFTP

La política aplica a ambos canales porque SFTP descarga el fichero a la misma canalización local de watch-folder. El origen SFTP sigue siendo estrictamente no destructivo: no se renombra, mueve ni elimina ningún archivo remoto.

## Fallo seguro

Ante metadata ausente, ilegible o con timestamp inválido, el archivo bruto se conserva.

No existe un modo de “borrar todo” ni una retención de cero días. El mínimo es un día y la activación debe ser explícita.

## Runtime

Después de `settleWatchFolder()`, cada ciclo puede ejecutar la poda configurada. El resumen del ciclo expone únicamente el contador agregado `archivedSourceFilesDeleted`; no se registran nombres de ficheros comerciales.

## Evidencia

Las pruebas y el gate CI deben demostrar:

- default `keep`;
- configuración de plazos fail-closed;
- eliminación solo opt-in;
- conservación de manifests/recibos;
- conservación de archivos huérfanos/sin metadata;
- aplicación equivalente a archivos locales provenientes de watch-folder o SFTP.
