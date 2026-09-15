# Runbook — rotación de credenciales

## Objetivo

Rotar credenciales Bearer/Basic y credenciales operativas `ops:read` sin cortar integraciones ni exponer secretos.

## Principios

- Nunca guardar tokens o contraseñas en Git.
- Nunca pasar el secreto como argumento visible del proceso.
- Durante la rotación, mantener temporalmente credencial antigua + nueva hasta verificar el cambio.
- Revocar la antigua solo después de confirmar que todos los clientes previstos usan la nueva.
- Una credencial de integración no recibe `ops:read` por defecto.

## Generar nueva credencial Bearer

```bash
read -s PV_SECRET
printf '%s' "$PV_SECRET" | npm run auth:hash -- bearer
unset PV_SECRET
```

Copiar únicamente el SHA-256 generado al fichero de auth protegido fuera del repositorio.

## Generar nueva credencial Basic

```bash
read -s PV_SECRET
printf '%s' "$PV_SECRET" | npm run auth:hash -- basic --username propietario
unset PV_SECRET
```

Conservar únicamente salt + scrypt en el fichero de auth.

## Rotación sin corte

1. Añadir la nueva credencial con un `id` distinto y el mismo scope de organización/instalación necesario.
2. Si es una credencial operativa global, añadir explícitamente `permissions: ["ops:read"]`; no copiar ese permiso a integraciones normales.
3. Validar la configuración fuera de Git y reiniciar de forma controlada.
4. Probar la nueva credencial contra una operación no destructiva:
   - integración: `POST /v1/preflight` con un fixture seguro del cliente;
   - operación: `GET /v1/ops/status`.
5. Actualizar el cliente/secret manager para usar la nueva credencial.
6. Observar logs/alertas y confirmar ausencia de errores de autenticación.
7. Eliminar la credencial antigua del fichero de auth.
8. Reiniciar de forma controlada y comprobar que la credencial antigua ya recibe 401.

## Rotación urgente por sospecha de compromiso

1. Crear y desplegar la credencial nueva inmediatamente.
2. Revocar la antigua sin esperar una ventana normal si el riesgo lo exige.
3. Revisar logs sanitizados de autenticación y rate limiting; no copiar secretos al incidente.
4. Rotar también secretos webhook o material relacionado si existe posibilidad de exposición conjunta.
5. Registrar qué `credentialId` fue revocado, cuándo y qué sistemas fueron actualizados.

## Rollback

Si la nueva credencial falla antes de revocar la antigua, restaurar la configuración anterior y diagnosticar. Si la antigua ya fue revocada por compromiso, **no reactivarla**; corregir la nueva credencial o emitir una tercera.

## Certificado AEAT

La rotación del certificado/mTLS no se ejecuta desde este runbook mientras el gate externo AEAT #6 siga abierto. El certificado y su clave privada permanecen exclusivamente en runtime seguro y nunca deben copiarse al repositorio o al chat.
