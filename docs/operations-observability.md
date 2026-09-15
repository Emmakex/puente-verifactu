# Operación, observabilidad y diagnóstico

## Correlación

Cada operación recibe `correlationId`, `organizationId`, `installationId`, `recordId` y, cuando exista, `sourceInvoiceId`. Los logs estructurados permiten seguir el recorrido completo sin exponer secretos.

## Métricas mínimas

- registros recibidos/validados/fiscalizados;
- aceptados/rechazados;
- cola y edad del mensaje más antiguo;
- latencia de AEAT;
- reintentos por causa;
- errores de certificado;
- conflictos de idempotencia;
- fallos por versión de conector;
- bloqueos de cadena.

## Reintentos

Solo errores clasificados como transitorios pueden reintentarse automáticamente. Usar backoff con jitter y límite. Un reintento de transporte reutiliza el mismo registro fiscal; no crea un alta nueva.

## Dead-letter / blocked

Los mensajes que superen política de reintento pasan a `blocked`/DLQ con diagnóstico accionable y procedimiento de recuperación. Nunca se descartan silenciosamente.

## Diagnóstico estructurado obligatorio

Todo fallo de CI, build, test, deploy o runtime debe poder resumirse con:

- pipeline/job/step o componente;
- comando/operación;
- código de salida/estado;
- mensaje principal;
- archivo/línea cuando exista;
- contexto mínimo;
- firma estable del error;
- causa raíz confirmada o hipótesis marcada;
- fix aplicado;
- validación ejecutada;
- referencia al PR/commit/incidente.

Formato conceptual:

```json
{
  "error_signature": "...",
  "component": "aeat-adapter",
  "operation": "submit-record",
  "primary_error": "...",
  "retryable": false,
  "root_cause_status": "confirmed|hypothesis|unknown",
  "correlation_id": "..."
}
```

## Alertas

Prioridad alta: acumulación de cola, múltiples rechazos consecutivos, expiración próxima de certificado, errores de autenticación AEAT, corrupción/ruptura de cadena, acceso cross-tenant detectado.

## Runbooks

Antes de producción deben existir runbooks para: AEAT no disponible, certificado expirado, rechazo masivo tras cambio de esquema, cola atascada, despliegue defectuoso, restauración de backup y reconciliación posterior.
