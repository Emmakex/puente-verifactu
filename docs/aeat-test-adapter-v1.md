# AEAT Test Adapter v1

## Objetivo

Encapsular toda la complejidad de comunicación VERI*FACTU con AEAT detrás de una única frontera server-side. CSV, Excel, WooCommerce, PrestaShop, ERP, API o SDK no conocen SOAP, WSDL, certificados ni endpoints AEAT.

## Fuentes oficiales verificadas

Revisión: **15-09-2026**.

- Portal técnico AEAT VERI*FACTU: https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica.html
- WSDL publicado: https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SistemaFacturacion.wsdl
- `SuministroLR.xsd`: https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroLR.xsd
- `SuministroInformacion.xsd`: https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroInformacion.xsd
- `RespuestaSuministro.xsd`: https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/RespuestaSuministro.xsd
- Descripción del servicio web, versión 1.0.3: `Veri-Factu_Descripcion_SWeb.pdf`.
- Validaciones y errores, versión 1.2.2: `Validaciones_Errores_Veri-Factu.pdf`.

Las URLs/versiones se mantienen en `packages/aeat-adapter/src/constants.mjs` y deben verificarse antes de cada release certificable.

## Contrato de transporte

El servicio oficial usa:

- HTTPS;
- SOAP 1.1;
- estilo document/literal;
- UTF-8;
- certificado electrónico cliente válido;
- respuesta síncrona.

El adaptador utiliza mTLS exclusivamente en backend. Ningún certificado o clave privada se entrega al navegador ni a conectores externos.

## Endpoints

El WSDL oficial distingue pruebas/producción y certificado ordinario/certificado de sello. El adaptador usa pruebas por defecto.

Producción está bloqueada por dos condiciones explícitas:

1. `environment: 'production'`;
2. `allowProduction: true`.

No existe degradación automática de pruebas a producción.

## Seguridad de credenciales

Reglas obligatorias:

- PFX/P12 y claves privadas fuera del repositorio;
- nunca incluir material secreto en issues, PRs, logs, fixtures o chats;
- cargar secretos en runtime desde vault/secret manager/archivo montado;
- PFX y clave privada llegan al transporte como `Buffer`;
- no serializar credenciales en JSON;
- no registrar passphrases;
- rotación/revocación se gestiona fuera del modelo de factura.

`.gitignore` bloquea extensiones/directorios comunes de certificados y secretos como segunda barrera, no como sustituto del secret scanning.

## Peticiones

`serializeAeatSoapRequest` genera:

- `Cabecera` con obligado a la emisión;
- representante opcional;
- remisión voluntaria opcional;
- entre 1 y 1000 `RegistroFactura`;
- `RegistroAlta` o `RegistroAnulacion`;
- encadenamiento;
- identificación del sistema informático;
- huella y timestamp ya fijados por el núcleo fiscal.

Una petición no puede mezclar obligados distintos.

## Desglose fiscal

`InvoiceIntent v1` admite hasta 12 líneas de desglose. Cada línea puede contener:

- impuesto;
- clave de régimen;
- clasificación/exención;
- tipo impositivo;
- base;
- cuota;
- tipo de recargo de equivalencia;
- cuota de recargo de equivalencia.

El recargo de equivalencia debe estar disponible a nivel de línea antes de la serialización AEAT. El formato agregado antiguo puede mantenerse para compatibilidad de ingestión, pero no sustituye el detalle requerido para remitir.

## Respuestas

Normalización global:

- `Correcto` → `accepted`;
- `ParcialmenteCorrecto` → `partial`;
- `Incorrecto` → `rejected`.

Normalización por registro:

- `Correcto` → `accepted`;
- `AceptadoConErrores` → `accepted_with_errors`;
- `Incorrecto` → `rejected`.

Se conservan códigos/descripciones de error, CSV, referencia externa y metadatos de duplicado cuando existan.

Un `SOAP Fault` se normaliza como fallo técnico. El `detail/callstack` recibido no se propaga a objetos de dominio ni logs de negocio.

## XML defensivo

La respuesta se trata como dato no confiable. El parser ligero actual:

- rechaza `DOCTYPE`;
- rechaza declaraciones `ENTITY`;
- no ejecuta entidades externas;
- extrae únicamente campos esperados por nombre local.

Si en una fase posterior se adopta una librería XML, deberá mantener explícitamente deshabilitados DTD/XXE y pasar estas mismas pruebas de regresión.

## Control de flujo y reintentos

AEAT puede devolver `TiempoEsperaEnvio`. El adaptador impide nuevas remisiones antes de cumplirse ese intervalo.

Se reintentan únicamente fallos técnicos razonablemente temporales: timeout, conexión, HTTP 5xx/408/429 y equivalentes.

No se reenvía automáticamente un rechazo funcional como si fuera el mismo intento. `accepted_with_errors` y `rejected` requieren revisar/corregir/subsanar conforme al caso.

El outbox en memoria de esta fase es una referencia ejecutable. La cola durable se implementará antes de producción.

## Gate externo de Fase 3

La implementación puede validarse completamente con tests contractuales sin secretos, pero **Fase 3 no se considera cerrada** hasta ejecutar una remisión real y controlada en el entorno oficial de pruebas AEAT.

Para cerrar el gate se requiere:

1. provisionar un certificado válido directamente en el entorno de ejecución, nunca en GitHub/chat;
2. configurar una organización/SIF de pruebas;
3. remitir un caso controlado al endpoint `prewww1` correspondiente;
4. recibir y guardar únicamente evidencia no sensible del resultado;
5. probar al menos respuesta correcta y un rechazo controlado;
6. confirmar `TiempoEsperaEnvio` y reconciliación;
7. documentar fecha, versión de artefactos y resultado del test.

Hasta completar este gate, no se avanza a Fase 4 según la regla **finish before advancing**.
