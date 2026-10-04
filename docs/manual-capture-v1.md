# Manual Capture v1 — Kairoseth Fiscal

Fecha de cierre funcional: **2026-10-04**.

## Objetivo

Cubrir el último escenario capability-first: autónomos y microempresas cuyo sistema no dispone de plugin compatible, API, webhook, export CSV/XLSX, base de datos legible, SFTP ni watch-folder.

La captura manual es una **superficie de entrada** de Kairoseth Fiscal. No crea un motor fiscal alternativo.

Flujo:

```text
Formulario manual
 -> payload neutral
 -> mapping server-side
 -> InvoiceIntent v1
 -> preflight
 -> confirmación humana
 -> preflight server-side repetido
 -> core fiscal
 -> outbox AEAT
 -> estado / presentación QR
```

## Rutas

- `POST /v1/manual/preflight`: transforma el payload neutral en `InvoiceIntent v1` y ejecuta preflight sin efectos.
- `POST /v1/manual/fiscal-records`: vuelve a ejecutar preflight server-side y solo emite si el resultado es válido.
- `GET /v1/fiscal-records/{recordId}/status`: consulta el estado mediante el lifecycle universal existente.

La UI se sirve en `/manual.html` y se abre desde el fallback `manual` del selector capability-first.

## Autoridad

El navegador nunca puede fijar:

- `organizationId`;
- `installationId`;
- `sourceSystem`;
- certificado o clave privada;
- entorno AEAT;
- MongoDB;
- `taxCode`, `regimeKey` u `operationClass`;
- reglas fiscales internas.

El servidor deriva tenant/instalación desde la autenticación y aplica el perfil manual soportado.

## Alcance fiscal v1

Para mantener el fallback manual seguro y comprensible, v1 soporta únicamente:

- EUR;
- operaciones interiores sujetas;
- IVA 21 %, 10 % o 4 %;
- una línea de desglose;
- F1/F2;
- R1-R5 con tipo de rectificación `I` o `S`;
- destinatario obligatorio para F1 y rectificativas;
- importes exactos con dos decimales.

El perfil server-side fija:

- `taxCode = 01`;
- `regimeKey = 01`;
- `operationClass = S1`.

Cualquier otro régimen o clasificación fiscal debe usar una integración configurada, MappingProfile específico o un canal más completo. El fallback manual **falla cerrado** y no intenta adivinar exenciones, no sujeciones, recargo de equivalencia u otras clasificaciones.

## Idempotencia

La identidad manual estable se deriva de:

```text
manual:{issueDate}:{series}:{number}
```

La clave de emisión es determinista:

```text
manual-issue:{issueDate}:{series}:{number}
```

Repetir exactamente la misma factura devuelve el mismo `recordId`. Cambiar contenido manteniendo la misma identidad produce conflicto de idempotencia y no crea un segundo registro.

## Preflight obligatorio

La UX exige:

1. completar el formulario;
2. pulsar “Validar sin emitir”;
3. revisar el resultado;
4. marcar una confirmación humana explícita;
5. pulsar “Emitir factura”.

Además, `POST /v1/manual/fiscal-records` ejecuta de nuevo el preflight en servidor inmediatamente antes de cualquier efecto. Por tanto, llamar directamente a la ruta de emisión no permite saltarse la validación.

## Rectificativas

La UI soporta `R1-R5` y exige:

- cliente identificado;
- método `I` (diferencias) o `S` (sustitución);
- en sustitución, base y cuota rectificadas.

La semántica final sigue validándose en el core común.

## UX y seguridad

- ES/EN;
- responsive;
- cálculo auxiliar de IVA con aritmética exacta en céntimos;
- importes calculados son editables y siempre se vuelven a validar server-side;
- CSP same-origin, sin scripts externos;
- QR expuesto únicamente como URL HTTPS de la presentación generada por el core;
- sin secretos ni datos de infraestructura en el cliente;
- sin envío automático: la acción fiscal requiere confirmación humana.

## Pruebas

La suite cubre:

- mapping neutral → `InvoiceIntent`;
- rechazo de campos de autoridad;
- rechazo de perfiles fiscales manuales no soportados;
- rectificativas;
- idempotencia estable;
- preflight sin efectos;
- emisión explícita;
- repetición idempotente;
- conflicto ante modificación;
- preflight server-side obligatorio;
- cálculo exacto de IVA en cliente.

Con este canal queda cubierto el escenario “ninguna capacidad de integración” de la Universal Integration Matrix.
