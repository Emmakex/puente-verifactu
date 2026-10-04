# DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN

Plantilla interna para Puente VeriFactu v0.1.0, alineada con el orden mínimo exigido por el artículo 15 de la Orden HAC/1177/2024. **No constituye una declaración firmada ni debe publicarse con datos ficticios.**

**a) Nombre del sistema informático a que se refiere la declaración responsable:**  
Puente VeriFactu

**b) Código identificador del sistema informático:**  
PV

**c) Identificador completo de la versión concreta del sistema informático:**  
0.1.0

**d) Componentes, hardware y software, breve descripción y principales funcionalidades:**  
Puente VeriFactu es un sistema informático de facturación modular para integración con sistemas empresariales. Incluye núcleo fiscal canónico, registros de alta y anulación, encadenamiento y huella SHA-256, adaptador AEAT VERI*FACTU, outbox durable, reconciliación oficial, API/SDK, importación CSV/XLSX, webhooks, captura manual y conectores WooCommerce/PrestaShop. El perfil productivo de esta versión corresponde a Kairoseth Fiscal sobre infraestructura Hostinger con persistencia MongoDB inyectada para cadena fiscal, API/idempotencia, importaciones, perfiles de integración y outbox AEAT. El runtime productivo Kairoseth no usa SQLite como persistencia de control-plane o data-plane y no requiere hardware propietario obligatorio.

**e) Indicación de si el sistema se ha producido para funcionar exclusivamente como «VERI*FACTU»:**  
S - Sí.

**f) Indicación de si el sistema permite ser usado por varios obligados tributarios o por un mismo usuario para varios obligados tributarios:**  
S - Sí.

**g) Tipos de firma utilizados cuando el sistema no sea utilizado como «VERI*FACTU»:**  
No aplicable en esta versión, producida para funcionar exclusivamente en modalidad «VERI*FACTU».

**h) Nombre y apellidos de la persona o razón social de la entidad productora:**  
<NOMBRE_O_RAZON_SOCIAL>

**i) Número de identificación fiscal (NIF) de la persona o entidad productora:**  
<NIF>

**j) Dirección postal completa de contacto de la persona o entidad productora:**  
<DIRECCION_POSTAL_COMPLETA>

**k) Manifestación de cumplimiento:**  
La persona o entidad productora hace constar que Puente VeriFactu, versión 0.1.0, cumple con lo dispuesto en el artículo 29.2.j) de la Ley 58/2003, de 17 de diciembre, General Tributaria; en el Reglamento aprobado por el Real Decreto 1007/2023, de 5 de diciembre; en la Orden HAC/1177/2024, de 17 de octubre; y en las especificaciones de la Agencia Estatal de Administración Tributaria que completan dicha orden y resultan aplicables a esta versión.

**l) Fecha y lugar de suscripción de la declaración responsable:**  
<FECHA_COMPLETA> — <LOCALIDAD, PAIS>

## Anexo recomendado

- Contacto adicional: <CONTACTO_OPCIONAL>
- Sitio web del productor/producto: <URL_OPCIONAL>
- Perfil de despliegue: Kairoseth / Hostinger / MongoDB (`kairoseth-hostinger-mongodb`).
- Conector WooCommerce: 0.2.0.
- Conector PrestaShop: 0.4.0.
- Evidencia externa AEAT: `docs/release/aeat-gate-6-evidence-2026-10-03.md`.

## Generación privada

Los datos personales del productor no deben introducirse en commits de trabajo ni en incidencias. Para generar el borrador privado:

```bash
cp config/responsible-declaration.example.json "$HOME/.puente-verifactu/secrets/declaration-v0.1.0.json"
chmod 600 "$HOME/.puente-verifactu/secrets/declaration-v0.1.0.json"

# Editar localmente el JSON con nombre/NIF/dirección/lugar/fecha.

npm run responsible-declaration:build -- \
  --producer "$HOME/.puente-verifactu/secrets/declaration-v0.1.0.json" \
  --output "$HOME/.puente-verifactu/evidence/declaracion-responsable-v0.1.0.md"
```

El generador crea el fichero con permisos `0600`, no lo sobrescribe y bloquea la salida dentro del repositorio hasta que exista una revisión explícita de publicación.

## Regla de publicación

La declaración final debe corresponder exactamente a una versión concreta, quedar visible dentro del sistema y estar disponible para cliente/comercializador. La publicación se realiza solo después de revisar el documento final y decidir conscientemente qué datos identificativos exigidos normativamente se van a hacer públicos con esa versión. El producto no debe presentarse como “certificado por AEAT”.
