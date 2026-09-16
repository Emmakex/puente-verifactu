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

### Verificar el bundle aceptado + rechazo

Cuando existan ambos ficheros sanitizados, valida que pertenecen al mismo candidato y a las versiones AEAT actuales:

```bash
npm run aeat:evidence:verify -- \
  --accepted ./private-evidence/aeat-accepted.json \
  --rejected ./private-evidence/aeat-rejected.json \
  --source-commit <SHA40>
```

El verificador falla cerrado si detecta, entre otros casos:

- evidencia de `dry-run` en lugar de remisión real;
- commits diferentes o distintos del commit candidato indicado;
- versiones WSDL/validaciones/esquema/registro diferentes de las fijadas actualmente en el adaptador;
- estado aceptado/rechazado distinto del esperado;
- aceptación sin fingerprint SHA-256 del CSV;
- rechazo sin código de diagnóstico normalizado;
- ausencia de un `TiempoEsperaEnvio` no negativo en ambas respuestas;
- hashes XML/registro inválidos;
- campos sensibles crudos como `xml`, `csv`, `passphrase`, `pfx` o descripciones de error sin sanitizar.

La salida del verificador es deliberadamente reducida: commit, versiones AEAT, hashes de evidencia y valores observados de `TiempoEsperaEnvio`. No reproduce los cuerpos de las evidencias.

Aunque todas estas comprobaciones pasen, el resultado es **`status: partial`**, mantiene `releaseUnblocked: false` y declara `remainingExternalEvidence: ["reconciliation"]`. Este comando acredita el bundle de transmisión; **no sustituye la comprobación externa de reconciliación ni puede cerrar el issue #6**.

## Reconciliación oficial sin reemisión

El adaptador implementa la operación oficial `ConsultaFactuSistemaFacturacion` para resolver resultados inciertos sin volver a remitir una factura a ciegas. Usa el mismo transporte mTLS y endpoint VERI*FACTU, pero construye una petición de consulta en lugar de `RegFactuSistemaFacturacion`.

La consulta se acota por:

- `PeriodoImputacion`, derivado de la fecha de la operación/factura;
- `RefExterna`, que Puente VeriFactu ya remite con el identificador estable del sistema origen.

`AeatOfficialReconciler` solo considera reconciliada una entrada si AEAT devuelve una única coincidencia exacta en:

- NIF emisor;
- número/serie fiscal;
- fecha de expedición;
- `RefExterna`;
- huella del registro.

Para un lote, **todas** las entradas deben quedar confirmadas. Solo entonces el outbox puede pasar de `reconciliation_required` a `completed`.

Estos resultados permanecen en `reconciliation_required` y no habilitan reemisión automática:

- `SinDatos`;
- mismatch de identidad o huella;
- más de un resultado;
- paginación;
- estado AEAT no reconocido;
- error HTTP/SOAP/transporte de la consulta.

Especialmente, `SinDatos` significa únicamente que esa consulta no localizó el registro; **no prueba que sea seguro reenviar**. El reconciliador siempre conserva `shouldReissue: false` y no contiene ninguna llamada a `submit()` ni transición automática `retry`.

Gate de contrato y smoke:

```bash
npm run aeat:reconciliation:smoke
npm run aeat:reconcile:smoke
```

## Semilla controlada para demostrar reconciliación

Para probar la consulta oficial sin fabricar un timeout ni realizar una segunda remisión, una ejecución **aceptada** del live gate puede crear una SQLite privada de un solo uso con la misma petición ya enviada, colocada localmente en `reconciliation_required`.

La semilla añade **cero llamadas `submit()`**. El orden es deliberado:

1. reservar una SQLite nueva y un fichero operador nuevo con `0600`;
2. si cualquiera existe, abortar antes de cargar el PFX o abrir red;
3. realizar la única remisión normal a AEAT;
4. exigir `status=accepted`;
5. persistir la misma identidad, `RefExterna` y huella en el outbox privado como `reconciliation_required`;
6. consultar después con `npm run aeat:reconcile`.

Guard adicional:

```bash
export AEAT_LIVE_SEND=YES
export AEAT_RECONCILIATION_SEED=YES
```

Ejecución aceptada con semilla:

```bash
npm run aeat:gate -- \
  --send \
  --expect accepted \
  --source-commit <SHA40> \
  --evidence-output ./private-evidence/aeat-accepted.json \
  --reconciliation-seed-db ./private-evidence/reconciliation.sqlite \
  --reconciliation-seed-output ./private-evidence/reconciliation-operator.json
```

La salida pública no muestra rutas privadas, job ID, NIF, XML, SOAP, certificado ni passphrase. El fichero `reconciliation-operator.json`, que debe permanecer fuera de Git, contiene localmente la ruta de la SQLite y el job ID necesarios para operar la consulta.

Primero consultar sin mutar la SQLite:

```bash
npm run aeat:reconcile -- \
  --db <databasePath-del-fichero-operador> \
  --job-id <jobId-del-fichero-operador> \
  --source-commit <SHA40> \
  --evidence-output ./private-evidence/aeat-reconciliation-inspect.json
```

Solo si la consulta devuelve coincidencia exacta y se quiere registrar el cierre local:

```bash
export AEAT_RECONCILIATION_APPLY=YES
npm run aeat:reconcile -- \
  --db <databasePath-del-fichero-operador> \
  --job-id <jobId-del-fichero-operador> \
  --source-commit <SHA40> \
  --evidence-output ./private-evidence/aeat-reconciliation-apply.json \
  --apply
```

`--apply` solo puede producir `reconciliation_required -> completed` después de una nueva consulta oficial con coincidencia exacta. `SinDatos`, mismatch, paginación o fallo de consulta mantienen la cuarentena.

Smoke técnico de la semilla:

```bash
npm run aeat:seed:smoke
```

Este mecanismo **no genera evidencia externa por sí solo**: el issue #6 continúa abierto hasta ejecutar la secuencia real con certificado válido y conservar la evidencia sanitizada correspondiente.

## Cadena de prueba

Por defecto cada ejecución usa un `NumeroInstalacion` temporal nuevo y genera `PrimerRegistro=S`. Esto evita que dos ejecuciones independientes dependan de un estado previo desconocido.

Para pruebas específicas de encadenamiento se deberá configurar un número de instalación estable y proporcionar el estado anterior de forma controlada; esa prueba pertenece al cierre completo del gate y no debe improvisarse modificando hashes manualmente.

## Cierre de Fase 3

El issue #6 solo puede cerrarse cuando exista evidencia no sensible de:

- remisión aceptada;
- rechazo funcional controlado con diagnóstico esperado;
- `TiempoEsperaEnvio`/comportamiento de control de flujo observado;
- reconciliación comprobada mediante `ConsultaFactuSistemaFacturacion` para el escenario elegido;
- fecha/hora y commit exacto;
- versiones WSDL/XSD/validaciones usadas;
- hashes de XML/evidencia, sin payload fiscal;
- CI final verde sobre el estado de código que se va a declarar candidato.

Después se actualizan roadmap y `config/release-gates.json`; solo entonces `release_status` puede pasar de `release_blocked` a `release_candidate` y se prepara la declaración responsable definitiva de esa versión.
