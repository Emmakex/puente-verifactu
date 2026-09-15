# Reglas globales de ingeniería

Estas reglas son obligatorias salvo ADR explícito que justifique una excepción.

1. **Server-authoritative.** Tenant, permisos, proveedor, entorno fiscal y credenciales se resuelven server-side.
2. **No privilege from client/model.** Navegador, cliente o salida de modelo nunca conceden roles, entitlements, credenciales ni permisos de herramientas.
3. **Secrets stay server-side.** Credenciales y certificados nunca llegan al navegador ni al contexto de un modelo.
4. **Tenant isolation.** Datos, secuencias y cadenas nunca cruzan organizaciones.
5. **EN/ES together.** Cambios customer-facing se entregan en inglés y español en el mismo cambio.
6. **Responsive/UX acceptance.** Todo cambio customer-facing debe pasar aceptación responsive/UX.
7. **Minimum sufficient validation.** Ejecutar los gates requeridos por el contrato cambiado, no trabajo irrelevante.
8. **Finish before advancing.** Fase N+1 no empieza hasta cerrar fase N. Única excepción: un gate exclusivamente externo puede diferirse mediante ADR cuando toda la implementación interna y validación ejecutable estén completas, exista un procedimiento reproducible y el gate siga bloqueando releases/pilotos/production readiness. Bugs, tests fallidos, deuda de seguridad o documentación pendiente nunca califican.
9. **Branch -> PR -> CI -> merge -> production verification.** No saltarse el flujo salvo emergencia documentada.
10. **No mutable fiscal history.** Un registro finalizado no se edita; las correcciones son nuevos registros.
11. **Idempotency by design.** Todo borde de red debe tolerar reintentos sin duplicación fiscal.
12. **Regulatory artifacts are versioned.** XSD/WSDL/reglas/fixtures usados por una release deben ser trazables.
13. **Errors must be actionable.** Fallos generan diagnóstico estructurado con firma, causa, fix y validación.
14. **Regression memory.** Todo error y solución relevante se documenta o prueba para evitar reincidencia.
15. **No floats for tax money.** Cálculos fiscales usan decimal exacto/enteros escalados.
16. **No silent discard.** Ningún registro o intento fallido se pierde sin estado recuperable.
17. **Docs are part of the contract.** Cambios de comportamiento actualizan documentación en el mismo PR.
18. **External truth wins.** Ante conflicto, normativa/artefactos oficiales vigentes prevalecen sobre documentación interna.
