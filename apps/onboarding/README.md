# Onboarding Wizard

Interfaz customer-facing ES/EN para conectar archivos CSV/XLSX mediante el **Principio Camaleón**.

El usuario no ve rutas internas del modelo canónico como interfaz principal y no necesita conocer XML, SOAP, hashes ni certificados AEAT.

## Flujo

1. subir el CSV/XLSX existente;
2. elegir hoja cuando proceda;
3. revisar mappings automáticos/dudosos;
4. completar una sola vez los datos fijos del negocio;
5. ejecutar preflight;
6. corregir únicamente las filas señaladas.

El wizard **no envía a AEAT**. Su alcance v1 termina en preflight.

## Backend requerido

Debe servirse bajo el mismo origen que la API autenticada o detrás de un proxy equivalente.

Rutas usadas:

- `POST /v1/imports/inspect` — body binario, `X-File-Name`, `X-Sheet` opcional;
- `POST /v1/imports/{importId}/preflight` — confirmaciones/configuración en JSON;
- `DELETE /v1/imports/{importId}` — borrado explícito de sesión.

La capa HTTP concreta debe preservar el body de upload como `Buffer`. No debe convertir XLSX a texto.

## Autenticación

El navegador utiliza la sesión de usuario de la futura aplicación web. Nunca contiene API keys server-to-server ni credenciales/certificados AEAT.

El backend resuelve `organizationId`, `installationId` y `sourceSystem`; esos valores no son editables en la UI.

## Sesiones temporales

`ImportSessionService` mantiene únicamente filas parseadas/metadatos necesarios para completar el preflight:

- TTL por defecto: 15 minutos;
- máximo 5 MiB de fichero de entrada;
- máximo 100 sesiones en la implementación en memoria;
- aislamiento por organización + instalación;
- el fichero binario original no se conserva;
- las sesiones caducadas se purgan;
- no se registran filas ni contenido del fichero en logs.

La implementación en memoria es adecuada como contrato/entorno de desarrollo. Antes de un deployment multi-instancia se sustituirá por almacenamiento temporal compartido con TTL y cifrado apropiado.

## UX ES/EN

Todos los textos visibles están definidos en `src/model.mjs`. Los destinos canónicos se muestran con etiquetas comprensibles, por ejemplo:

- `number` → “Número de factura / Invoice number”;
- `issueDate` → “Fecha de expedición / Issue date”;
- `totals.totalAmount` → “Total factura / Invoice total”.

Los mappings `review` requieren confirmación explícita. Cambiar manualmente una propuesta automática también la convierte en `review`.

## Seguridad

- el wizard no puede elegir tenant, certificado, entorno AEAT ni permisos;
- mappings manuales solo pueden apuntar a una allowlist de destinos canónicos;
- rutas peligrosas (`__proto__`, `prototype`, `constructor`) se bloquean también en el core;
- dos columnas no pueden mapearse al mismo destino;
- configuración fija acepta únicamente una allowlist;
- las consultas de sesión cross-tenant responden como no encontradas.

## Desarrollo

Es una app web ligera sin framework obligatorio (`index.html`, `styles.css`, `app.js`). Esto evita acoplar el contrato de onboarding a una plataforma frontend concreta y facilita integrarlo más adelante en portal SaaS, WordPress admin u otra superficie.
