# AEAT VERI*FACTU Adapter

Adaptador server-side que encapsula la complejidad SOAP/XML, mTLS, endpoints y respuestas de AEAT. Los conectores de origen nunca llaman directamente a AEAT.

## Estado

Implementación de **Fase 3** preparada para el entorno de pruebas, pendiente únicamente del gate externo con un certificado electrónico válido provisionado de forma segura.

No utilizar contra producción todavía.

## Responsabilidades

- serializar registros fiscales internos a SOAP 1.1 / XML AEAT;
- limitar lotes a 1–1000 registros y un único obligado por petición;
- seleccionar endpoint de pruebas/producción con guard explícito para producción;
- usar certificado cliente mediante mTLS;
- normalizar respuesta global, líneas, errores y SOAP Faults;
- respetar `TiempoEsperaEnvio`;
- separar respuestas retryable conocidas de resultados de transporte inciertos;
- consultar registros presentados mediante la operación oficial `ConsultaFactuSistemaFacturacion` para reconciliar resultados inciertos sin reemitir;
- proteger contra DTD/entidades en XML de respuesta;
- mantener certificado/clave fuera de browser, modelos, logs y repositorio.

## Credenciales

Nunca pegar certificados, PFX/P12, claves privadas o passwords en código, issues, logs, PRs ni chats.

El runtime debe cargar el certificado desde un gestor de secretos o archivo montado fuera del repositorio. El transporte exige que PFX y claves privadas lleguen como `Buffer`, evitando configuraciones fácilmente serializables.

Ejemplo conceptual server-side:

```js
import { readFile } from 'node:fs/promises';
import { createHttpsMtlsTransport } from './src/index.mjs';

const transport = createHttpsMtlsTransport({
  tls: {
    pfx: await readFile(process.env.AEAT_PFX_PATH),
    passphrase: process.env.AEAT_PFX_PASSPHRASE,
  },
});
```

No se incluye ningún certificado de ejemplo.

## Entornos

Por defecto el adaptador usa el endpoint oficial **de pruebas**. El endpoint de producción requiere `environment: 'production'` y `allowProduction: true` de forma explícita.

El uso de certificado de sello se selecciona mediante `useSealEndpoint` y tiene endpoint separado, tal como publica el WSDL oficial.

## Outbox y reintentos

`AeatOutboxWorker` separa cuatro situaciones:

- respuesta final AEAT: termina el job como `completed`;
- respuesta retryable conocida: vuelve a `pending` con backoff;
- fallo no retryable: queda `blocked`;
- resultado incierto tras iniciar dispatch: queda `reconciliation_required` y **no se reenvía automáticamente**.

Se considera resultado incierto, como mínimo, un `transport_error`, una excepción inesperada durante el dispatch o un lease de procesamiento que vence tras crash/reinicio. El motivo es deliberadamente conservador: si no podemos demostrar que AEAT no recibió la petición, repetirla de forma ciega puede crear una duplicidad operacional.

Una reconciliación explícita debe decidir una de estas acciones:

- `complete`: se confirma que la operación ya quedó resuelta;
- `block`: requiere corrección o intervención;
- `retry`: solo cuando se ha confirmado que una nueva remisión es segura.

El store en memoria sigue disponible para tests. El perfil durable single-node usa `SqliteAeatOutboxStore` desde `packages/sqlite-store`, con persistencia de estado, backoff, intentos y leases.

`TiempoEsperaEnvio` bloquea una nueva remisión hasta que se cumpla el intervalo indicado por AEAT.

Gate específico:

```bash
npm run aeat:outbox:smoke
```

## Reconciliación oficial por consulta

`AeatOfficialReconciler` utiliza la operación oficial `ConsultaFactuSistemaFacturacion` del mismo servicio VERI*FACTU y el mismo transporte mTLS. La consulta se limita mediante `PeriodoImputacion` y `RefExterna`; no genera un nuevo registro ni llama a `submit()`.

Para cada entrada en `reconciliation_required` se compara contra la respuesta almacenada por AEAT:

- NIF emisor;
- número/serie fiscal;
- fecha de expedición, normalizada entre formato AEAT e ISO;
- `RefExterna`;
- huella del registro.

El job pasa automáticamente a `completed` **solo** cuando cada entrada del lote produce una única coincidencia exacta y el estado almacenado es reconocido. Todos los resultados no concluyentes permanecen en `reconciliation_required`:

- `SinDatos`;
- respuesta paginada;
- múltiples coincidencias;
- mismatch de identidad o huella;
- estado almacenado desconocido;
- fallo HTTP, transporte o SOAP.

`SinDatos` no se interpreta como prueba de que sea seguro reenviar. El reconciliador expone siempre `shouldReissue: false` y nunca transforma por sí mismo el job a `pending`.

Gate específico:

```bash
npm run aeat:reconciliation:smoke
```

El contrato CI adicional impide introducir una llamada a `submit()` o una acción automática `retry` dentro del reconciliador.

## Gate externo pendiente

Para cerrar Fase 3 falta ejecutar una remisión controlada al endpoint oficial de pruebas con certificado válido, verificar aceptación/rechazo y demostrar una reconciliación real mediante la consulta oficial. Hasta entonces el issue #6 y el bloqueo de release/piloto fiscal real siguen abiertos.
