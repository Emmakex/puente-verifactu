# Arquitectura

## Enfoque

Puente VeriFactu se diseña como **núcleo fiscal + puertos/adaptadores**. La plataforma de origen solo conoce el contrato público; la lógica AEAT permanece centralizada.

```text
[Woo/ERP/CRM/App]
      |
      v
[Adapter / Connector]
      |
      v
[Ingress API / SDK]
      |
      v
[Canonical validation]
      |
      v
[Fiscal Engine] ---> [Hash Chain]
      |                    |
      +------> [Immutable Fiscal Store]
      |
      v
[Outbox / Delivery Queue]
      |
      v
[AEAT VERI*FACTU Adapter]
      |
      v
[AEAT test / production]
      |
      v
[Response Normalizer] -> [Status / webhook / polling]
```

## Componentes

### 1. Connector adapter

Extrae facturas del sistema origen, asigna identificadores estables, transforma al contrato canónico y nunca contiene credenciales AEAT de larga duración en frontend.

### 2. Ingress

Autentica organización y conector, valida esquema, controla rate limit y exige `Idempotency-Key` o identificador fiscal equivalente.

### 3. Fiscal engine

Responsable de reglas canónicas, clasificación del tipo de operación, normalización de fechas/importes, generación de registros y protección de invariantes.

### 4. Hash chain

Construye el material de huella exactamente como indique la especificación AEAT vigente. El algoritmo y orden de campos deben vivir en un módulo versionado y cubierto por fixtures oficiales.

### 5. Fiscal store

Append-only para registros fiscales finalizados. Las correcciones no sobrescriben: generan anulación, subsanación, sustitución o nuevo alta según proceda.

### 6. Outbox / delivery

Separa la transacción local de la comunicación externa. Cada registro pasa por estados explícitos y reintentos idempotentes.

### 7. AEAT adapter

Encapsula WSDL/XSD, transporte, certificado, endpoints de prueba/producción, timeouts y normalización de errores. Ningún conector llama directamente a AEAT.

### 8. Status API

Expone estado interno sin filtrar secretos, XML sensible ni detalles de otros tenants.

## Estados sugeridos

`received -> validated -> fiscalized -> queued -> sending -> accepted | accepted_with_errors | rejected | retry_scheduled | blocked`

Los estados fiscales históricos se conservan; no se modelan mediante mutaciones destructivas.

## Multi-tenant

Toda entidad persistida incluye `organization_id`. Claves, certificados, secuencias, cadenas de hash e idempotencia se particionan por organización y, cuando proceda, por instalación/SIF. Nunca se puede encadenar un registro de una organización con otra.

## Consistencia

- Escritura fiscal + outbox en una misma transacción cuando la tecnología lo permita.
- Bloqueo/serialización del tramo que calcule la cadena para evitar carreras.
- Reintento de entrega no vuelve a fiscalizar el registro.
- Un callback duplicado no altera dos veces el estado.

## Versionado

Los contratos públicos se versionan. Los cambios incompatibles requieren versión mayor o estrategia de migración. Los artefactos AEAT (XSD/WSDL/reglas) se versionan internamente con su fecha de verificación.
