# Connector Contract Suite v2

Suite ejecutable para comprobar que un conector de terceros respeta el contrato mínimo de Puente VeriFactu sin depender del framework, ERP o lenguaje del sistema origen.

## Qué valida

La versión 2 mantiene todos los invariantes de v1 y añade una semántica común de reconciliación/fallback:

- interfaz `preflight / send / status / sync`;
- preflight delegado una sola vez y sin fiscalizar;
- `eventId` obligatorio para crear una operación nueva;
- `Idempotency-Key` presente y estable;
- misma operación → misma clave;
- eventos distintos → claves distintas;
- consulta de estado usando el `recordId` recibido;
- si ya existe `recordId`, `sync()` **solo reconcilia**: no ejecuta preflight ni issue;
- un fallo al reconciliar, incluso si es recuperable, **nunca autoriza a reemitir** otra operación fiscal;
- sin `recordId`, `sync()` exige preflight antes de issue;
- un preflight bloqueado no crea registro fiscal;
- un fallo retryable durante issue conserva la misma idempotencia en el siguiente intento;
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
sync(source, { eventId, recordId })
```

Contrato de `sync()`:

1. Si hay `recordId`, consultar ese registro y devolver/propagar el resultado. **Nunca** crear otro registro como fallback.
2. Si no hay `recordId`, exigir `eventId` antes de hacer llamadas remotas.
3. Ejecutar preflight.
4. Si el preflight no pasa, detenerse sin emitir.
5. Si pasa, emitir usando una idempotencia determinista derivada del mismo evento.
6. Si el issue falla de forma retryable, un reintento del mismo evento debe reutilizar exactamente la misma clave.

Puede usar la vía canónica (`client.preflight/issue`) o mapeada (`client.preflightMapped/issueMapped`).

## Ejemplo seguro

```js
async sync(source, { eventId, recordId } = {}) {
  if (recordId) return this.status(recordId);
  if (!eventId) throw new TypeError('eventId is required');

  const preflight = await this.preflight(source);
  if (!preflight.ok) return { status: 'blocked', preflight };

  return this.send(source, { eventId });
}
```

La ausencia deliberada de fallback `status -> issue` es parte del contrato fiscal: perder temporalmente la capacidad de consultar un `recordId` existente nunca significa que sea seguro crear una segunda operación.

## Ejecutar

Desde este repositorio:

```bash
node packages/connector-contract-suite/src/cli.mjs --module ./puente-contract.mjs
```

El resultado es JSON estable con `suiteVersion: 2`. Un fallo devuelve exit code `1`, por lo que se puede incorporar directamente al CI del integrador.

## Nuestro conector de referencia

```bash
npm run contract:reference
```

Ese comando prueba `connectors/reference` con la misma suite que utilizará un tercero.

## Relación con conectores nativos

WooCommerce y PrestaShop ya implementan conceptualmente `send-or-reconcile`: si poseen un `recordId`, reconcilian en vez de crear otro. La siguiente capa de Fase 5 adapta esta semántica v2 a gates específicos ejecutables de cada extensión nativa; no se considera implícitamente validada solo por este runner Node.

## Versionado

`CONNECTOR_CONTRACT_SUITE_VERSION` identifica el contrato del runner. v2 es un cambio incompatible respecto a v1 porque añade `sync()`. Un conector compatible únicamente con v1 debe adoptar explícitamente la nueva operación antes de declararse compatible con v2.
