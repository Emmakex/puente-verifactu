# Connector Contract Suite v1

Suite ejecutable para comprobar que un conector de terceros respeta el contrato mínimo de Puente VeriFactu sin depender del framework, ERP o lenguaje del sistema origen.

## Qué valida

- interfaz `preflight / send / status`;
- preflight delegado una sola vez y sin fiscalizar;
- `eventId` obligatorio para enviar;
- `Idempotency-Key` presente;
- misma operación → misma clave;
- eventos distintos → claves distintas;
- consulta de estado usando el `recordId` recibido;
- payload de origen no mutado;
- el conector no inyecta tenant, instalación, certificados, passphrases, entorno AEAT o permisos en el payload.

La suite **no certifica cumplimiento regulatorio** ni sustituye los gates AEAT. Valida únicamente el contrato de integración con Puente VeriFactu.

## Adaptador mínimo

Crear un archivo local, por ejemplo `puente-contract.mjs`:

```js
import { MiConector } from './mi-conector.mjs';

export const sampleSource = {
  numero: 'A-100',
  fecha: '2026-09-15',
  total: '121.00',
};

export function createConnectorUnderTest({ client, profileId, sourceName }) {
  return new MiConector({ client, profileId, sourceName });
}
```

El conector debe exponer:

```text
preflight(source)
send(source, { eventId })
status(recordId)
```

Puede usar la vía canónica (`client.preflight/issue`) o mapeada (`client.preflightMapped/issueMapped`).

## Ejecutar

Desde este repositorio:

```bash
node packages/connector-contract-suite/src/cli.mjs --module ./puente-contract.mjs
```

El resultado es JSON estable:

```json
{
  "suiteVersion": 1,
  "ok": true,
  "summary": {
    "checks": 9,
    "passed": 9,
    "failed": 0
  }
}
```

Un fallo devuelve exit code `1`, por lo que se puede incorporar directamente al CI del integrador.

## Nuestro conector de referencia

```bash
npm run contract:reference
```

Ese comando prueba `connectors/reference` con la misma suite que utilizará un tercero.

## Versionado

`CONNECTOR_CONTRACT_SUITE_VERSION` identifica el contrato del runner. Los cambios incompatibles requerirán una versión de suite nueva; un conector compatible con v1 no debe romperse silenciosamente por cambios internos del motor fiscal.
