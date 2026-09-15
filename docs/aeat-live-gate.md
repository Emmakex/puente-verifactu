# AEAT live gate — runbook

## Objetivo

Cerrar el gate externo de Fase 3 con pruebas controladas y repetibles contra el entorno oficial de pruebas AEAT, sin almacenar certificados, claves privadas, passphrases, XML fiscal ni respuestas SOAP crudas en el repositorio.

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
- muestra únicamente un resumen con NIF enmascarado, tamaño XML, SHA-256 del XML y versiones AEAT fijadas por el adaptador.

Para inspección local explícita del XML:

```bash
npm run aeat:gate -- --show-xml
```

`--show-xml` está **prohibido junto con `--send`**. No pegues el XML en issues, chats o logs públicos porque contiene datos fiscales.

## Certificado y passphrase

El certificado se carga desde una ruta local o volumen montado. La passphrase puede suministrarse directamente al proceso o, preferiblemente, mediante un fichero secreto independiente.

Opción con fichero secreto:

```bash
export AEAT_TEST_PFX_PATH='/run/secrets/aeat-test.pfx'
export AEAT_TEST_PFX_PASSPHRASE_FILE='/run/secrets/aeat-test.passphrase'
```

Alternativa:

```bash
export AEAT_TEST_PFX_PATH='/run/secrets/aeat-test.pfx'
export AEAT_TEST_PFX_PASSPHRASE='...'
```

No configures simultáneamente ambas fuentes de passphrase. Nunca guardes el PFX o la passphrase en Git, `.env` versionado, CI público, issue, ticket o chat.

### Preflight local del PFX — sin red

Antes de cualquier prueba real ejecuta:

```bash
npm run aeat:cert:check
```

Este comando comparte exactamente el mismo cargador/validador de PFX que `aeat:gate -- --send`, pero **no importa ni crea transporte HTTP/mTLS y no abre ninguna conexión de red**. Comprueba que:

- `AEAT_TEST_PFX_PATH` existe y puede leerse;
- solo hay una fuente de passphrase;
- Node/OpenSSL puede abrir el contenedor PKCS#12/PFX con la passphrase suministrada;
- el resumen público no contiene la ruta local ni la passphrase.

La salida incluye únicamente tamaño, SHA-256 del PFX, origen de la passphrase (`file`, `environment` o `none`) y `networkUsed: false`.

Un resultado `ok` **no demuestra** por sí solo que el certificado esté vigente, autorizado por AEAT, corresponda al obligado o sea aceptado por el endpoint. Es deliberadamente un preflight local del contenedor y la passphrase; la validación externa sigue siendo el issue #6.

## Caso aceptado

La ejecución normal espera `accepted`:

```bash
export AEAT_LIVE_SEND=YES
npm run aeat:gate -- --send --expect accepted
```

Para crear evidencia no sensible ligada al commit probado:

```bash
npm run aeat:gate -- \
  --send \
  --expect accepted \
  --source-commit <SHA40> \
  --evidence-output ./private-evidence/aeat-accepted.json
```

El fichero de evidencia se crea sin sobrescritura y con permisos restrictivos. No contiene certificado, passphrase, XML, respuesta SOAP cruda ni CSV completo.

## Rechazo controlado

El harness permite que un rechazo esperado cuente como prueba correcta del mecanismo de diagnóstico:

```bash
npm run aeat:gate -- \
  --send \
  --expect rejected \
  --source-commit <SHA40> \
  --evidence-output ./private-evidence/aeat-rejected.json
```

El dato utilizado para provocar el rechazo debe elegirse deliberadamente conforme a una validación oficial vigente y documentarse fuera del repositorio si contiene información sensible. El harness **no inventa ni altera automáticamente** una regla fiscal para forzar el rechazo.

Estados aceptados por `--expect`: `accepted`, `partial`, `rejected` y `fault`. Si AEAT devuelve un estado distinto del esperado, el proceso falla con `VF_AEAT_GATE_UNEXPECTED_STATUS`.

## Evidencia sanitizada

La salida/evidencia conserva únicamente datos útiles para demostrar el resultado:

- estado global normalizado;
- presencia del CSV + SHA-256 del CSV, nunca el valor completo;
- `TiempoEsperaEnvio`;
- estado y código de error por registro;
- SHA-256 de descripciones/mensajes cuando existan, no el texto potencialmente sensible;
- indicador de duplicado;
- commit probado;
- versiones AEAT (`WSDL`, validaciones, esquema y registro) fijadas en el adaptador;
- SHA-256 del XML, no el XML.

## Cadena de prueba

Por defecto cada ejecución usa un `NumeroInstalacion` temporal nuevo y genera `PrimerRegistro=S`. Esto evita que dos ejecuciones independientes dependan de un estado previo desconocido.

Para pruebas específicas de encadenamiento se deberá configurar un número de instalación estable y proporcionar el estado anterior de forma controlada; esa prueba pertenece al cierre completo del gate y no debe improvisarse modificando hashes manualmente.

## Cierre de Fase 3

El issue #6 solo puede cerrarse cuando exista evidencia no sensible de:

- remisión aceptada;
- rechazo funcional controlado con diagnóstico esperado;
- `TiempoEsperaEnvio`/comportamiento de control de flujo observado;
- reconciliación comprobada para el escenario elegido;
- fecha/hora y commit exacto;
- versiones WSDL/XSD/validaciones usadas;
- hashes de XML/evidencia, sin payload fiscal;
- CI final verde sobre el estado de código que se va a declarar candidato.

Después se actualizan roadmap y `config/release-gates.json`; solo entonces `release_status` puede pasar de `release_blocked` a `release_candidate` y se prepara la declaración responsable definitiva de esa versión.
