import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function argValue(flag, argv = process.argv) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
}

function requiredString(value, field) {
  const text = String(value ?? '').trim();
  if (!text) {
    const error = new Error(`Missing required declaration field: ${field}`);
    error.code = 'VF_RESPONSIBLE_DECLARATION_FIELD_REQUIRED';
    error.field = field;
    throw error;
  }
  return text;
}

function assertIsoDate(value) {
  const text = requiredString(value, 'signature.date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    const error = new Error('signature.date must be YYYY-MM-DD');
    error.code = 'VF_RESPONSIBLE_DECLARATION_DATE_INVALID';
    error.field = 'signature.date';
    throw error;
  }
  return text;
}

function formatSpanishDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function isInsideRepo(path) {
  const rel = relative(REPO_ROOT, resolve(path));
  return rel === '' || (!rel.startsWith('..') && !rel.includes('..' + '/'));
}

export async function buildResponsibleDeclaration({
  producerConfig,
  packageJson,
  releaseGates,
  outputPath,
}) {
  const producer = producerConfig?.producer ?? {};
  const signature = producerConfig?.signature ?? {};

  const producerName = requiredString(producer.name, 'producer.name');
  const producerTaxId = requiredString(producer.taxId, 'producer.taxId');
  const postalAddress = requiredString(producer.postalAddress, 'producer.postalAddress');
  const signingPlace = requiredString(signature.place, 'signature.place');
  const signingDate = assertIsoDate(signature.date);

  const version = requiredString(packageJson?.version, 'package.version');
  const deploymentProfile = requiredString(
    releaseGates?.deployment_profile,
    'release.deployment_profile',
  );
  if (deploymentProfile !== 'kairoseth-hostinger-mongodb') {
    const error = new Error(
      'Responsible declaration must target the Kairoseth Hostinger + MongoDB release profile',
    );
    error.code = 'VF_RESPONSIBLE_DECLARATION_PROFILE_INVALID';
    error.field = 'release.deployment_profile';
    throw error;
  }
  const output = resolve(requiredString(outputPath, '--output'));

  if (isInsideRepo(output)) {
    const error = new Error('Responsible declaration output must remain outside the repository until explicit publication review');
    error.code = 'VF_RESPONSIBLE_DECLARATION_REPO_OUTPUT_FORBIDDEN';
    error.field = '--output';
    throw error;
  }

  const optionalContacts = [];
  if (String(producer.otherContact ?? '').trim()) optionalContacts.push(`- Contacto adicional: ${String(producer.otherContact).trim()}`);
  if (String(producer.website ?? '').trim()) optionalContacts.push(`- Sitio web: ${String(producer.website).trim()}`);

  const content = `# DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN

**a) Nombre del sistema informático a que se refiere la declaración responsable:**  
Puente VeriFactu

**b) Código identificador del sistema informático:**  
PV

**c) Identificador completo de la versión concreta del sistema informático:**  
${version}

**d) Componentes, hardware y software, breve descripción y principales funcionalidades:**  
Puente VeriFactu es un sistema informático de facturación de arquitectura modular para integración con sistemas empresariales. La versión ${version} incluye núcleo fiscal canónico, generación y encadenamiento de registros de alta y anulación, huella SHA-256, adaptador de remisión y consulta VERI*FACTU mediante servicios AEAT, outbox durable, reconciliación de resultados inciertos, API/SDK, importación CSV/XLSX, webhooks, conectores nativos para WooCommerce y PrestaShop, Kairoseth Local Agent para integraciones read-only/SFTP/watch-folder y captura manual universal. El perfil productivo declarado se ejecuta dentro de Kairoseth sobre infraestructura Hostinger con persistencia MongoDB inyectada y autoridad fiscal/certificado server-side. SQLite queda limitado al perfil standalone de desarrollo, prueba y referencia y no forma parte de la persistencia productiva del candidato. No requiere hardware propietario específico.

**e) Indicación de si el sistema se ha producido para funcionar exclusivamente como «VERI*FACTU»:**  
S - Sí.

**f) Indicación de si el sistema permite ser usado por varios obligados tributarios o por un mismo usuario para varios obligados tributarios:**  
S - Sí.

**g) Tipos de firma utilizados cuando el sistema no sea utilizado como «VERI*FACTU»:**  
No aplicable en esta versión, al estar producida para funcionar exclusivamente en modalidad «VERI*FACTU».

**h) Nombre y apellidos de la persona o razón social de la entidad productora:**  
${producerName}

**i) Número de identificación fiscal (NIF) de la persona o entidad productora:**  
${producerTaxId}

**j) Dirección postal completa de contacto de la persona o entidad productora:**  
${postalAddress}

**k) Manifestación de cumplimiento:**  
La persona productora hace constar que Puente VeriFactu, versión ${version}, cumple con lo dispuesto en el artículo 29.2.j) de la Ley 58/2003, de 17 de diciembre, General Tributaria; en el Reglamento aprobado por el Real Decreto 1007/2023, de 5 de diciembre; en la Orden HAC/1177/2024, de 17 de octubre; y en las especificaciones publicadas por la Agencia Estatal de Administración Tributaria que completan dicha orden y resultan aplicables a esta versión.

**l) Fecha y lugar de suscripción de la declaración responsable:**  
${formatSpanishDate(signingDate)} — ${signingPlace}

## Anexo informativo recomendado

${optionalContacts.length ? optionalContacts.join('\n') : '- Sin datos adicionales de contacto declarados en este borrador.'}

- Repositorio/producto: Puente VeriFactu.
- Modalidad fiscal: VERI*FACTU.
- Perfil de despliegue productivo: Kairoseth en Hostinger + MongoDB (${deploymentProfile}).
- Artefactos técnicos versionados/fingerprintados en la evidencia de release: conector WooCommerce, conector PrestaShop y Kairoseth Local Agent.
- Canales adicionales cubiertos por el mismo core: API/SDK, webhook, CSV/XLSX y captura manual.
- Evidencia técnica del gate externo AEAT: documentada de forma sanitizada para la versión candidata.

---

Esta declaración corresponde exclusivamente a la versión ${version}. Debe conservarse junto con la evidencia de release de esa versión y ponerse a disposición del usuario/cliente conforme a la normativa aplicable.
`;

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, content, { flag: 'wx', mode: 0o600 });
  await chmod(output, 0o600);

  return {
    schema_version: 1,
    status: 'written',
    system: 'Puente VeriFactu',
    system_code: 'PV',
    version,
    deployment_profile: deploymentProfile,
    contains_personal_data: true,
    repository_output: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const producerPath = resolve(requiredString(argValue('--producer'), '--producer'));
  const outputPath = requiredString(argValue('--output'), '--output');

  const [producerConfig, packageJson, releaseGates] = await Promise.all([
    readFile(producerPath, 'utf8').then(JSON.parse),
    readFile(resolve(REPO_ROOT, 'package.json'), 'utf8').then(JSON.parse),
    readFile(resolve(REPO_ROOT, 'config/release-gates.json'), 'utf8').then(JSON.parse),
  ]);

  const result = await buildResponsibleDeclaration({
    producerConfig,
    packageJson,
    releaseGates,
    outputPath,
  });
  console.log(JSON.stringify(result, null, 2));
}
