# Seguridad y privacidad

## Objetivos

Proteger credenciales, certificados, datos fiscales y separación entre organizaciones, preservando además la trazabilidad exigida al sistema.

## Reglas no negociables

- Credenciales de proveedor/AEAT nunca llegan al navegador ni al contexto de un modelo.
- Autorización, tenant y selección de credenciales se resuelven server-side.
- Ningún dato cruza límites de organización.
- Certificados y claves privadas se cifran en reposo y se descifran solo en el proceso autorizado.
- Logs no contienen claves privadas, passwords, tokens completos ni XML sin redacción cuando incluya datos innecesarios.
- Producción y pruebas usan credenciales/configuración separadas.
- Nunca se pegan certificados, PFX/P12, claves privadas o passphrases en chats, issues, PRs, fixtures o documentación.
- PFX/P12 y claves privadas se cargan únicamente en runtime; el transporte AEAT exige el material privado como `Buffer`, no como string serializable.

## Autenticación

Conectores: autenticación server-to-server con credenciales rotables. Usuarios: RBAC separado del rol del conector. Los permisos del navegador no otorgan capacidades fiscales por sí solos.

## Gestión de secretos

Los secretos se gestionan en un secret manager, vault o archivo montado fuera del repositorio. Nunca en Git, variables de frontend, dumps de soporte o tickets. Debe existir rotación y revocación.

Para AEAT, el entorno de ejecución recibe solo una referencia/ruta/secret binding. El repositorio no contiene certificados de ejemplo. `.gitignore` bloquea formatos y carpetas comunes de material sensible como segunda barrera defensiva.

## Aislamiento tenant

Todas las consultas se filtran por `organization_id` en la capa de autorización y en repositorio. Los tests deben incluir intentos explícitos de acceso cruzado.

## Integridad

Los registros finalizados se almacenan de forma append-only lógica. Cualquier modificación administrativa crea un evento de auditoría; nunca se reescribe silenciosamente un registro fiscal.

## XML / transporte AEAT

- Endpoint seleccionado server-side desde una allowlist de pruebas/producción.
- Producción requiere habilitación explícita; nunca se deduce del payload del cliente.
- TLS valida el certificado del servidor; no se permite `rejectUnauthorized=false` en producción.
- Respuestas XML se consideran no confiables: DTD y entidades están bloqueados para evitar XXE.
- SOAP Faults se normalizan sin propagar `detail/callstack` internos a logs de negocio.
- Payloads XML completos con NIF/datos fiscales no se registran por defecto.

## Privacidad

Aplicar minimización de datos, retención documentada y controles de acceso. No duplicar datos personales en logs o métricas. Las exportaciones de soporte deben redactarse por defecto.

## Amenazas prioritarias

- replay de peticiones;
- duplicación por reintentos;
- robo de certificado;
- acceso cross-tenant;
- SSRF hacia endpoints arbitrarios;
- manipulación de callback/webhook;
- inyección XML / XXE;
- alteración del reloj/configuración;
- envío accidental a producción;
- modificación de registros ya fiscalizados;
- privilegios concedidos desde cliente.

## Respuesta a incidentes

Todo incidente de seguridad debe registrar alcance, tenants potencialmente afectados, credenciales expuestas, línea temporal, contención, rotación, corrección, validación y acciones preventivas.
