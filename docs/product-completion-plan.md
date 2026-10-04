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

**Cerrado en #90:** confirmación explícita, sesiones TTL, batch durable, lease,
emisión reanudable, idempotencia estable por fila y export seguro están
fusionados en `main` con smoke MongoDB real y CI 19/19 verde.

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

**Cierre en esta unidad:** cadena fiscal, API records/Idempotency-Key, AEAT outbox,
readiness y observabilidad usan stores/health providers MongoDB inyectados. El
runtime incorpora un modo explícito `kairoseth` que no crea ni requiere SQLite.

Perfil productivo Kairoseth:

- cadena fiscal e idempotencia fiscal: MongoDB;
- API records e Idempotency-Key: MongoDB con lease recuperable;
- CSV/XLSX sessions/batches: MongoDB;
- Local Agent registry: MongoDB;
- onboarding/integration profiles: MongoDB;
- AEAT outbox: MongoDB con lease y `reconciliation_required`;
- backup status: proveedor inyectado por Kairoseth;
- observabilidad/readiness: MongoDB-aware.

SQLite queda exclusivamente como perfil `standalone`/dev/test.

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

Hecho:

- starter kits HTTP/JSON y ejemplos multi-lenguaje para Node.js, Python, PHP y cURL, con gate CI y sin lógica fiscal en cliente;
- política explícita de retención de archivos processed/error del Local Agent: default keep, poda raw-source opt-in por antigüedad y conservación de metadata sanitizada;
- formulario manual universal con payload neutral, mapping server-side, preflight obligatorio, confirmación humana, idempotencia estable y status/QR.

**P2 cerrado:** ya no quedan gaps universales declarados que bloqueen el cierre técnico del producto. El siguiente tramo es congelar el candidato final (#43) y preparar el piloto (#53).

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
