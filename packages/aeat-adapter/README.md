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
- separar fallos técnicos reintentables de rechazos funcionales;
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

## Reintentos

Los fallos de transporte/HTTP temporal se pueden reintentar mediante outbox. Un rechazo AEAT no se reintenta ciegamente: se completa el intento y se genera después una operación de corrección/subsanación cuando corresponda.

`TiempoEsperaEnvio` bloquea una nueva remisión hasta que se cumpla el intervalo indicado por AEAT.

## Gate externo pendiente

Para cerrar Fase 3 falta ejecutar una remisión controlada al endpoint oficial de pruebas con certificado válido, verificar la respuesta y documentar el resultado sin guardar secretos ni datos fiscales reales en el repositorio.
