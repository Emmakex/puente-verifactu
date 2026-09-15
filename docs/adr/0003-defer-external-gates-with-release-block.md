# ADR-0003 — Diferir gates externos sin desbloquear releases

- Estado: Aceptado
- Fecha: 2026-09-15

## Contexto

La regla global **finish before advancing** evita acumular fases parcialmente implementadas. Sin embargo, algunos gates dependen exclusivamente de recursos externos que no deben formar parte del repositorio ni del entorno de CI, por ejemplo certificados electrónicos, credenciales reguladas o ventanas de validación de terceros.

En Fase 3 de Puente VeriFactu, la implementación, tests contractuales, seguridad, XML/SOAP, transporte mTLS y harness de prueba están terminados. El único gate restante es una remisión real al entorno oficial de pruebas AEAT con un certificado válido provisionado fuera de GitHub.

Bloquear todo desarrollo posterior por una dependencia externa ya aislada no mejora la calidad del producto y sí genera un cuello de botella artificial.

## Decisión

Se permite avanzar en desarrollo a la siguiente fase cuando el único trabajo pendiente de la fase anterior sea un **gate externo diferible** y se cumplan todas estas condiciones:

1. La implementación interna de la fase está completa.
2. Todos los tests y gates ejecutables sin el recurso externo están verdes.
3. El recurso externo no debe almacenarse en Git, CI público, issues, PRs o chats.
4. Existe un procedimiento reproducible para ejecutar el gate cuando el recurso esté disponible.
5. El gate queda registrado como issue abierto y visible en el roadmap.
6. El gate pendiente bloquea explícitamente cualquier release, piloto real o declaración de production readiness que dependa de él.
7. La fase no se marca como completamente cerrada hasta que el gate externo se ejecute y su evidencia no sensible quede registrada.

## Consecuencia para Puente VeriFactu

Fase 4 puede desarrollarse mientras permanece abierto el gate externo de Fase 3 (#6).

Esto **no autoriza**:

- producción;
- pilotos fiscales reales;
- activar endpoints AEAT de producción;
- declarar cumplimiento final;
- emitir una release productiva.

Todos esos hitos siguen bloqueados hasta cerrar #6 y los gates posteriores aplicables.

## Principio operativo

**Development may advance; release readiness may not.**

La excepción se aplica solo a dependencias externas claramente aisladas. Bugs, tests fallidos, contratos incompletos, deuda de seguridad o documentación pendiente nunca califican como gate externo diferible.
