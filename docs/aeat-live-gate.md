# AEAT live gate — runbook

## Objetivo

Cerrar el gate externo de Fase 3 con una prueba controlada y repetible contra el entorno oficial de pruebas AEAT, sin almacenar certificados ni claves privadas en el repositorio.

El comando es **dry-run por defecto**. La remisión real requiere dos acciones simultáneas:

1. pasar `--send`;
2. definir `AEAT_LIVE_SEND=YES`.

Aunque ambas se cumplan, el adaptador sigue fijado al entorno `test`. El guard de producción del adaptador no se desactiva.

## Configuración mínima

Variables necesarias para generar el fixture:

```bash
export AEAT_TEST_ISSUER_NAME='Empresa de pruebas SL'
export AEAT_TEST_ISSUER_NIF='B00000000'
export AEAT_TEST_PRODUCER_NIF='B00000000'
```

Opcionales:

```bash
export AEAT_TEST_PRODUCER_NAME='Kairoseth Extensions'
export AEAT_TEST_SOFTWARE_NAME='Puente VeriFactu'
export AEAT_TEST_SOFTWARE_VERSION='0.1.0'
export AEAT_TEST_SYSTEM_ID='PV'
export AEAT_TEST_TIMEZONE='Europe/Madrid'
export AEAT_TEST_SERIES='PVGATE-'
```

No copies literalmente los NIF de ejemplo. Usa únicamente los datos autorizados para el certificado y entorno de pruebas correspondiente.

## Dry-run

```bash
npm run aeat:gate
```

El dry-run:

- genera un `InvoiceIntent F2` mínimo de 1,21 EUR;
- crea un registro de alta y su huella real;
- usa un `NumeroInstalacion` temporal único (`GATE-YYYYMMDDHHMMSS`), salvo que se configure otro;
- serializa el XML AEAT completo;
- no abre ninguna conexión de red;
- muestra únicamente un resumen con NIF enmascarado, tamaño XML y SHA-256 del XML.

Para inspección local explícita del XML:

```bash
npm run aeat:gate -- --show-xml
```

No pegues ese XML en issues, chats o logs públicos porque contiene datos fiscales.

## Remisión real a pruebas

El certificado se carga desde una ruta local o volumen montado:

```bash
export AEAT_TEST_PFX_PATH='/run/secrets/aeat-test.pfx'
export AEAT_TEST_PFX_PASSPHRASE='...'
export AEAT_LIVE_SEND=YES
npm run aeat:gate -- --send
```

Nunca guardes la passphrase en un `.env` versionado, historial de shell compartido, CI público o ticket.

## Resultado

La herramienta imprime únicamente campos normalizados:

- `status`;
- `CSV` cuando exista;
- `TiempoEsperaEnvio`;
- estado por registro;
- código/descripción funcional de error.

No imprime el PFX, clave privada, passphrase ni la respuesta SOAP cruda.

El proceso termina con código 0 solo cuando la respuesta global queda `accepted`. Otros resultados deben revisarse antes de marcar el gate como cerrado.

## Cadena de prueba

Por defecto cada ejecución usa un `NumeroInstalacion` temporal nuevo y genera `PrimerRegistro=S`. Esto evita que dos ejecuciones independientes dependan de un estado previo desconocido.

Para pruebas específicas de encadenamiento se deberá configurar un número de instalación estable y proporcionar el estado anterior de forma controlada; esa prueba pertenece al cierre completo del gate y no debe improvisarse modificando hashes manualmente.

## Cierre de Fase 3

Tras una ejecución aceptada se debe actualizar el issue del gate con evidencia **no sensible**:

- fecha/hora;
- commit probado;
- versiones WSDL/XSD;
- estado normalizado;
- CSV parcialmente redactado si se decide conservarlo;
- `TiempoEsperaEnvio`;
- hash del XML (`xmlSha256`), no el XML completo.

Después se ejecuta CI de nuevo y solo entonces se marca Fase 3 como ✅.
