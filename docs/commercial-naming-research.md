# Investigación de naming comercial — Puente VeriFactu

Fecha de revisión: 2026-10-03.

## Objetivo

Definir la faceta comercial de `Puente VeriFactu` dentro de Kairoseth Platform siguiendo el patrón ya establecido:

```text
Puente DeCA      -> Kairoseth Cargo
Puente VeriFactu -> Kairoseth Fiscal
```

El nombre técnico `Puente VeriFactu` y el `product_id=puente-verifactu` permanecen estables.

## Decisión comercial

**Kairoseth Fiscal** fue seleccionado como nombre comercial el 2026-10-03 y ya se utiliza en Kairoseth Platform con la ruta canónica `/products/kairoseth-fiscal`.

La selección comercial no equivale a un dictamen jurídico de registrabilidad. La búsqueda formal OEPM/EUIPO continúa siendo due diligence de marca y no debe confundirse con el estado técnico o comercial del producto.

## Hallazgos de mercado

### 1. El territorio "VeriFactu" está muy saturado

Se encontraron productos actuales como:

- tuVerifactu;
- esVeriFactu;
- VerifacTool;
- VeriFactus;
- Verifactu Simple;
- Verifactufy;
- VeriSys;
- soluciones que venden directamente "VeriFactu SaaS".

Además, la AEAT utiliza oficialmente `VERI*FACTU` como denominación del sistema.

Conclusión: no conviene construir la marca comercial diferenciadora añadiendo otra variante tipo `Veri...` o `...Factu`. La palabra debe mantenerse en descriptor, SEO y copy comercial.

### 2. Hay conflicto semántico en nombres de integración fiscal obvios

Encontrados en uso:

- `NEXO` en el mercado español con módulo VeriFactu.
- `FiscalFlow` en España.
- `FiscalLink` como producto de integración fiscal.
- `FiscalBridge` en varios mercados y productos API/fiscales.
- `FiscalCore` en España, también con posicionamiento VeriFactu.

Conclusión: evitar `Nexo`, `FiscalFlow`, `FiscalLink`, `FiscalBridge` y `FiscalCore` como nombre comercial.

### 3. SEO no obliga a meter "VeriFactu" dentro de la marca

Consulta Semrush, base España, 2026-10-03:

| Keyword | Volumen mensual aprox. | KD |
|---|---:|---:|
| verifactu | 60.500 | 50 |
| facturación verifactu | 1.300 | 40 |
| software verifactu | 880 | 33 |
| api verifactu | 720 | 21 |
| programa verifactu | 480 | 32 |
| verifactu api | 480 | 20 |
| verifactu woocommerce | 320 | 5 |
| verifactu prestashop | 260 | 8 |
| erp verifactu | 170 | 12 |
| verifactu excel | 140 | 16 |
| crm verifactu | 30 | 9 |

Conclusión: la marca puede ser propia y diferenciadora. El tráfico regulatorio se captura con título, H1, descriptor, páginas de canal y contenido SEO.

Ejemplo de arquitectura SEO:

```text
Kairoseth <Marca>
VeriFactu para cualquier software
WooCommerce · PrestaShop · ERP · Excel · API
```

## Riesgo de usar VERIFACTU como marca principal

La AEAT utiliza `VERI*FACTU` como nombre oficial del sistema. Además, una búsqueda preliminar de registros publicados encontró una marca figurativa denominada `Verifactu`, expediente OEPM M-4317358, concedida en 2026 para clase 09 según publicaciones del BOPI reproducidas por un agregador de información registral.

Esto **no es un dictamen jurídico ni un clearance de marca**. Antes de bloquear un nombre comercial debe hacerse búsqueda formal en OEPM/EUIPO de las clases relevantes.

Decisión vigente: usar `VeriFactu` como descriptor de producto/compatibilidad y **Kairoseth Fiscal** como marca comercial.

## Patrón de Kairoseth Cargo

`Kairoseth Cargo` funciona porque:

- usa una palabra de dominio amplia y comprensible;
- no copia el nombre jurídico/técnico DeCA;
- permite explicar debajo qué norma/proceso resuelve;
- el motor técnico puede evolucionar sin renombrar la superficie comercial.

Para Puente VeriFactu debemos repetir la misma lógica.

## Territorios evaluados

### Kairoseth Fiscal

**Encaje:** alto.

Ventajas:
- dominio claro: fiscalidad/cumplimiento fiscal;
- no implica que sustituyamos el ERP;
- puede crecer a futuras capacidades fiscales si se decide;
- sigue el patrón simple `Kairoseth + categoría`;
- búsqueda web exacta preliminar de `"Kairoseth Fiscal"`: sin resultados indexados encontrados.

Riesgos:
- `Fiscal` es descriptivo/genérico;
- hay muchas marcas compuestas con "Fiscal";
- requiere clearance OEPM/EUIPO antes de fijarlo.

### Kairoseth Relay

**Encaje:** medio-alto.

Ventajas:
- representa bien un puente de datos;
- diferenciación mayor;
- compatible con API, ERP, Excel, DB y plugins;
- búsqueda web exacta preliminar: sin resultados indexados encontrados.

Riesgos:
- no comunica fiscalidad por sí solo;
- necesita descriptor permanente: `VeriFactu para cualquier software`.

### Kairoseth Ledger

**Encaje:** medio.

Ventajas:
- término conocido en software financiero;
- sugiere registro/trazabilidad;
- búsqueda web exacta preliminar: sin resultados indexados encontrados.

Riesgos:
- puede hacer pensar que somos contabilidad/libro mayor;
- Puente no sustituye la contabilidad del cliente.

### Kairoseth Gateway

**Encaje:** medio.

Ventajas:
- describe una capa intermedia/API;
- apto para producto técnico.

Riesgos:
- lenguaje demasiado infra para autónomos/pymes;
- "Gateway" es muy genérico en software/compliance.

## Descartes preliminares

No avanzar como candidatos:

- Kairoseth Nexo — producto NEXO ya opera en España con VeriFactu.
- Kairoseth FiscalFlow — FiscalFlow está en uso.
- Kairoseth FiscalLink — FiscalLink está en uso.
- Kairoseth FiscalBridge — FiscalBridge está ampliamente utilizado.
- Kairoseth FiscalCore — FiscalCore está en uso en España y comunica VeriFactu.
- cualquier variante `Veri...` / `...Factu` como núcleo de marca — mercado saturado y mayor proximidad con denominaciones existentes.

## Resultado de la investigación

Selección adoptada:

1. **Kairoseth Fiscal** — nombre comercial activo.
2. Kairoseth Relay — alternativa archivada.
3. Kairoseth Ledger — alternativa archivada.

## Due diligence de marca pendiente

Antes de una inversión amplia en marca o registro se mantiene como tarea jurídica/comercial:

1. búsqueda exacta OEPM;
2. búsqueda EUIPO/TMview;
3. revisión de clases 9 y 42 como mínimo, y 35 si aplica;
4. búsquedas fonéticas y similares.

Esto no bloquea el uso actual de **Kairoseth Fiscal** como faceta comercial controlada ni altera la identidad técnica `puente-verifactu`.
