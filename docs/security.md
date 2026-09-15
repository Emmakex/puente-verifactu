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

## Autenticación

Conectores: autenticación server-to-server con credenciales rotables. Usuarios: RBAC separado del rol del conector. Los permisos del navegador no otorgan capacidades fiscales por sí solos.

## Gestión de secretos

Los secretos se gestionan en un secret manager o mecanismo equivalente. Nunca en Git, variables de frontend, dumps de soporte o tickets. Debe existir rotación y revocación.

## Aislamiento tenant

Todas las consultas se filtran por `organization_id` en la capa de autorización y en repositorio. Los tests deben incluir intentos explícitos de acceso cruzado.

## Integridad

Los registros finalizados se almacenan de forma append-only lógica. Cualquier modificación administrativa crea un evento de auditoría; nunca se reescribe silenciosamente un registro fiscal.

## Privacidad

Aplicar minimización de datos, retención documentada y controles de acceso. No duplicar datos personales en logs o métricas. Las exportaciones de soporte deben redactarse por defecto.

## Amenazas prioritarias

- replay de peticiones;
- duplicación por reintentos;
- robo de certificado;
- acceso cross-tenant;
- SSRF hacia endpoints arbitrarios;
- manipulación de callback/webhook;
- inyección en XML;
- alteración del reloj/configuración;
- modificación de registros ya fiscalizados;
- privilegios concedidos desde cliente.

## Respuesta a incidentes

Todo incidente de seguridad debe registrar alcance, tenants potencialmente afectados, credenciales expuestas, línea temporal, contención, rotación, corrección, validación y acciones preventivas.
