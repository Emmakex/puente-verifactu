# Product Completion Plan — Puente VeriFactu / Kairoseth Fiscal

Fecha de decisión: **2026-10-04**.

## Objetivo

Terminar el producto técnico y demostrarlo en piloto antes de dedicar más desarrollo a pricing, billing, checkout o CRM comercial.

## Regla de prioridad

Mientras este plan no esté cerrado:

- no abrir nuevos trabajos de pricing/billing salvo corrección de seguridad o regresión;
- no ampliar el pipeline comercial salvo corrección crítica;
- toda nueva unidad debe reducir un gap de producto, release o piloto;
- infraestructura Kairoseth permanece **Hostinger + MongoDB**;
- PostgreSQL/MySQL/MariaDB/SQL Server son únicamente fuentes externas read-only del cliente;
- certificado, reglas fiscales y autoridad AEAT permanecen server-side.

## Camino crítico

### P1 — U10 CSV/XLSX durable en Kairoseth MongoDB (#84)

**Implementación en curso:** confirmación explícita, store MongoDB TTL/durable,
lease de batch, emisión reanudable y export seguro forman una única unidad de
cierre. No se considera P1 cerrado hasta que el smoke MongoDB real y CI estén verdes.

Debe cerrar el flujo:

```text
upload
 -> mapping
 -> preflight
 -> confirmación explícita
 -> intents congelados
 -> batch durable MongoDB
 -> emisión idempotente
 -> reanudación/retry
 -> historial
 -> export por fila
```

Criterios de salida:

- sesiones temporales con TTL;
- batch confirmado durable por organization + installation;
- no persistir binario original;
- idempotencia estable por fila;
- lease para evitar doble worker;
- crash-resume;
- resultados sanitizados;
- export JSON/CSV;
- Puente recibe un persistence bridge, nunca Mongo URI/client/password.

### P1.5 — Persistencia data-plane Kairoseth en MongoDB (#91)

Tras U10 hay que eliminar la dependencia productiva de SQLite en el runtime Kairoseth para:

- cadena fiscal / operación idempotente;
- API records e Idempotency-Key;
- cualquier outbox/observabilidad que siga dependiendo del perfil SQLite y sea aplicable al deployment Kairoseth.

SQLite continúa como perfil standalone/dev/test. Kairoseth productivo debe recibir stores MongoDB inyectados y fallar cerrado ante una configuración parcial.

### P2 — Gaps universales restantes (#55)

Hecho:

- WooCommerce;
- PrestaShop;
- API/SDK;
- webhook;
- CSV/XLSX + mapping/preflight;
- visual capability onboarding;
- DB read-only PostgreSQL/MySQL/MariaDB/SQL Server;
- watch-folder;
- SFTP read-only;
- Local Agent portable Linux/Windows/macOS;
- instalación nativa y upgrade/rollback.

Pendiente:

- starter kits HTTP/JSON y ejemplos multi-lenguaje;
- formulario manual universal;
- política de retención de archivos processed/error del Local Agent.

### P3 — Candidato final (#43)

Después del último cambio funcional:

- congelar SHA candidato;
- CI completo verde;
- regenerar release evidence para ese SHA;
- regenerar bundle sanitizado;
- preparar y aprobar declaración responsable definitiva de esa versión.

Ninguna evidencia ligada a un SHA anterior autoriza el release nuevo.

### P4 — Piloto progresivo (#53)

Con el candidato congelado:

- readiness gate;
- aprobación privada;
- backup lifecycle real;
- observabilidad sin alertas críticas;
- alcance progresivo;
- stop conditions;
- rollback code-first;
- revisión de evidencia y decisión de avance.

## Trabajo deferido

Hasta cerrar P1–P4 quedan aparcados:

- pricing y cuotas (#320 en Kairoseth Platform);
- billing/checkout;
- Stripe/Redsys;
- ampliaciones CRM/comerciales (#324);
- métricas/filtros/export comerciales no necesarios para operar el piloto.

La foundation comercial ya fusionada se conserva, pero no es camino crítico.

## Definición de producto terminado

Para este ciclo, consideramos el producto terminado cuando:

1. los canales declarados como soportados tienen flujo seguro end-to-end;
2. el deployment Kairoseth usa sus bridges y MongoDB para la persistencia productiva de control-plane y data-plane;
3. no quedan gaps P1/P2 que bloqueen un caso prometido;
4. existe un candidato final reproducible con evidencia vigente;
5. la declaración responsable corresponde exactamente al candidato;
6. el piloto progresivo se ejecuta y se revisa;
7. solo entonces se abre el tramo de pricing/billing y venta amplia.
