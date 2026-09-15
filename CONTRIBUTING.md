# Contributing

## Flujo

1. Crear rama desde `main`.
2. Implementar un cambio acotado.
3. Ejecutar gates mínimos suficientes.
4. Actualizar documentación y tests.
5. Abrir PR con alcance, riesgos, validación y rollback.
6. Esperar CI/revisión antes de merge.
7. Verificar el resultado tras merge/deploy.

## Commits

Preferir Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`.

## Cambios regulatorios

Marcar explícitamente cualquier PR que altere hash, XML, contratos AEAT, QR, declaración responsable o semántica fiscal. Debe adjuntar fuente oficial y pruebas de conformidad.

## Definition of Done

Código + tests + documentación + observabilidad necesaria + migraciones + seguridad relevante + aceptación del contrato afectado.
