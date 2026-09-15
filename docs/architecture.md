# Arquitectura

## Enfoque

Puente VeriFactu se diseña como **núcleo fiscal + puertos/adaptadores + capa camaleónica de ingestión**. La plataforma de origen solo conoce el contrato apropiado a sus capacidades; la lógica AEAT permanece centralizada.

```text
[Manual] [CSV/XLSX] [Webhook] [REST/SDK] [Native connector]
    \         |          |          |            /
     +--------+----------+----------+-----------+
                         |
                         v
              [Mapping / Preflight]
                         |
                         v
                 [Canonical Contract]
                         |
                         v
                   [Fiscal Engine] ---> [Hash Chain]
                         |                    |
                         +------> [Immutable Fiscal Store]
                         |
                         v
                  [Outbox / Delivery]
                         |
                         v
               [AEAT VERI*FACTU Adapter]
                         |
                         v
               [Response Normalizer]
                         |
                         v
               [Status / webhook / UI]
```

## Capas

### 1. Ingestion adapters

Aceptan entradas heterogéneas. Su responsabilidad termina cuando producen un candidato al contrato canónico. No contienen lógica regulatoria.

### 2. Mapping & Preflight

Transforma nombres/formatos del origen mediante `MappingProfile`, valida sin efectos y devuelve errores accionables. Es obligatorio antes de activar mappings nuevos o modificados.

### 3. Ingress

Autentica organización e instalación, valida esquema, controla límites y exige idempotencia.

### 4. Canonical contract

Frontera estable entre cualquier integración y el motor. Todo canal debe poder representar el mismo caso fiscal de forma equivalente.

### 5. Fiscal engine

Responsable de reglas canónicas, normalización, clasificación, generación de registros y protección de invariantes.

### 6. Hash chain

Construye el material de huella conforme a la especificación oficial versionada y comprobada mediante fixtures.

### 7. Fiscal store

Append-only para registros finalizados. Las correcciones nunca reescriben historial.

### 8. Outbox / delivery

Separa transacción local y comunicación externa; mantiene estados explícitos y reintentos idempotentes.

### 9. AEAT adapter

Único componente que encapsula XML/XSD/WSDL, certificados, transporte, endpoints y normalización de respuestas AEAT.

### 10. Status surface

API/UI/webhooks presentan un estado normalizado sin exponer secretos o datos cross-tenant.

## Estados sugeridos

`received -> preflight_valid -> fiscalized -> queued -> sending -> accepted | accepted_with_errors | rejected | retry_scheduled | blocked`

## Multi-tenant

Toda entidad persistida incluye `organization_id`. Claves, certificados, secuencias, cadenas de hash e idempotencia se particionan por organización y, cuando proceda, por instalación/SIF. Nunca se encadena un registro de una organización con otra.

## Consistencia

- Escritura fiscal + outbox en la misma transacción cuando sea posible.
- Serialización del tramo que calcule la cadena para evitar carreras.
- Reintentar entrega no vuelve a fiscalizar.
- Un callback duplicado no altera dos veces el estado.
- Cambiar `MappingProfile` crea una versión; no reinterpreta registros históricos.

## Versionado

Contratos públicos, mappings y artefactos AEAT se versionan. Cambios incompatibles requieren versión mayor o migración explícita.
