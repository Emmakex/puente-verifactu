export const DEFAULT_NATIVE_CONNECTORS = Object.freeze(['prestashop', 'woocommerce']);

const ALLOWED_INPUT = new Set([
  'locale',
  'nativeConnector',
  'hasApi',
  'canWebhook',
  'canUploadFiles',
  'canReadDatabase',
  'canWatchFolder',
  'canSftp',
  'isLocalApplication',
]);

const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'organizationId',
  'installationId',
  'tenantId',
  'certificate',
  'certificatePath',
  'pfx',
  'privateKey',
  'aeat',
  'aeatEnvironment',
  'taxRules',
  'fiscalRules',
  'apiKey',
  'token',
  'password',
]);

const COPY = Object.freeze({
  native_plugin: Object.freeze({
    es: Object.freeze({ title: 'Conector nativo', summary: 'Conecta tu plataforma directamente con Kairoseth Fiscal.' }),
    en: Object.freeze({ title: 'Native connector', summary: 'Connect your platform directly to Kairoseth Fiscal.' }),
  }),
  rest_api: Object.freeze({
    es: Object.freeze({ title: 'API universal', summary: 'Integra tu sistema mediante la API de Kairoseth Fiscal.' }),
    en: Object.freeze({ title: 'Universal API', summary: 'Integrate your system through the Kairoseth Fiscal API.' }),
  }),
  webhook: Object.freeze({
    es: Object.freeze({ title: 'Webhook', summary: 'Envía eventos desde tu sistema y deja el mapping y la fiscalidad en Kairoseth.' }),
    en: Object.freeze({ title: 'Webhook', summary: 'Send events from your system while mapping and fiscal authority stay in Kairoseth.' }),
  }),
  file_upload: Object.freeze({
    es: Object.freeze({ title: 'Excel / CSV', summary: 'Sube tus ficheros y configura el mapping desde Kairoseth.' }),
    en: Object.freeze({ title: 'Excel / CSV', summary: 'Upload your files and configure mapping from Kairoseth.' }),
  }),
  database_read: Object.freeze({
    es: Object.freeze({ title: 'Base de datos read-only', summary: 'El Local Agent lee tu base de datos sin modificar el ERP.' }),
    en: Object.freeze({ title: 'Read-only database', summary: 'The Local Agent reads your database without modifying the ERP.' }),
  }),
  sftp: Object.freeze({
    es: Object.freeze({ title: 'SFTP', summary: 'El Local Agent recoge ficheros por SFTP sin modificar el origen.' }),
    en: Object.freeze({ title: 'SFTP', summary: 'The Local Agent collects files over SFTP without modifying the source.' }),
  }),
  watch_folder: Object.freeze({
    es: Object.freeze({ title: 'Carpeta local', summary: 'El Local Agent procesa ficheros exportados por tu aplicación local.' }),
    en: Object.freeze({ title: 'Local folder', summary: 'The Local Agent processes files exported by your local application.' }),
  }),
  manual: Object.freeze({
    es: Object.freeze({ title: 'Captura manual', summary: 'Introduce la factura en Kairoseth y usa el mismo preflight y motor fiscal.' }),
    en: Object.freeze({ title: 'Manual capture', summary: 'Enter the invoice in Kairoseth and use the same preflight and fiscal engine.' }),
  }),
});

const STEPS = Object.freeze({
  native_plugin: Object.freeze(['install_native_connector', 'bind_kairoseth_account', 'run_preflight']),
  rest_api: Object.freeze(['create_server_credential', 'configure_mapping_profile', 'run_preflight']),
  webhook: Object.freeze(['configure_webhook_endpoint', 'configure_mapping_profile', 'run_preflight']),
  file_upload: Object.freeze(['open_file_wizard', 'review_mapping', 'run_preflight']),
  database_read: Object.freeze(['provision_local_agent', 'configure_read_only_database', 'run_doctor', 'run_preflight']),
  sftp: Object.freeze(['provision_local_agent', 'configure_read_only_sftp', 'run_doctor', 'run_preflight']),
  watch_folder: Object.freeze(['provision_local_agent', 'configure_watch_folder', 'run_doctor', 'run_preflight']),
  manual: Object.freeze(['open_manual_capture', 'run_preflight', 'confirm_issue']),
});

function fail(code, message) {
  return Object.assign(new Error(message), { code, status: 400 });
}

function boolean(value, name) {
  if (value == null) return false;
  if (typeof value !== 'boolean') throw fail('VF_ONBOARDING_CAPABILITY_INVALID', `${name} must be boolean`);
  return value;
}

function normalizeLocale(value) {
  const locale = String(value ?? 'es').trim().toLowerCase();
  if (locale === 'es' || locale.startsWith('es-')) return 'es';
  if (locale === 'en' || locale.startsWith('en-')) return 'en';
  throw fail('VF_ONBOARDING_LOCALE_UNSUPPORTED', 'locale must be es or en');
}

function normalizeNativeConnector(value) {
  if (value == null || value === '') return null;
  const connector = String(value).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(connector)) {
    throw fail('VF_ONBOARDING_CAPABILITY_INVALID', 'nativeConnector is invalid');
  }
  return connector;
}

function strategy({
  id,
  channel,
  commercialFamily,
  deploymentMode,
  requiresLocalAgent,
  sourceKind = null,
  adapter,
  nativeConnector = null,
  warnings = [],
  locale,
}) {
  return Object.freeze({
    schemaVersion: 1,
    strategyId: id,
    channel,
    adapter,
    nativeConnector,
    commercialFamily,
    deploymentMode,
    requiresLocalAgent,
    sourceKind,
    mapping: 'server-side',
    fiscalAuthority: 'kairoseth',
    tenantAuthority: 'kairoseth',
    certificateCustody: 'kairoseth',
    autoIssue: false,
    autoProvision: false,
    returnsSecrets: false,
    locale,
    copy: COPY[channel],
    nextSteps: STEPS[channel],
    warnings: Object.freeze(warnings),
  });
}

export function resolveKairosethIntegrationStrategy(input = {}, {
  supportedNativeConnectors = DEFAULT_NATIVE_CONNECTORS,
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw fail('VF_ONBOARDING_CAPABILITY_INVALID', 'capability input must be an object');
  }

  for (const key of Object.keys(input)) {
    if (FORBIDDEN_AUTHORITY_FIELDS.has(key)) {
      throw fail('VF_ONBOARDING_AUTHORITY_FIELD_FORBIDDEN', `${key} is controlled by Kairoseth`);
    }
    if (!ALLOWED_INPUT.has(key)) {
      throw fail('VF_ONBOARDING_CAPABILITY_UNKNOWN', `unsupported capability field: ${key}`);
    }
  }

  const supported = new Set(
    [...supportedNativeConnectors].map((value) => String(value).trim().toLowerCase()),
  );
  const locale = normalizeLocale(input.locale);
  const nativeConnector = normalizeNativeConnector(input.nativeConnector);
  const nativeSupported = nativeConnector != null && supported.has(nativeConnector);
  const warnings = nativeConnector && !nativeSupported
    ? ['native_connector_not_supported']
    : [];

  if (nativeSupported) {
    return strategy({
      id: 'native-plugin',
      channel: 'native_plugin',
      commercialFamily: 'web',
      deploymentMode: 'platform-plugin',
      requiresLocalAgent: false,
      adapter: nativeConnector,
      nativeConnector,
      locale,
    });
  }

  if (boolean(input.hasApi, 'hasApi')) {
    return strategy({
      id: 'universal-rest-api',
      channel: 'rest_api',
      commercialFamily: 'api',
      deploymentMode: 'server-to-server',
      requiresLocalAgent: false,
      adapter: 'universal-rest',
      warnings,
      locale,
    });
  }

  if (boolean(input.canWebhook, 'canWebhook')) {
    return strategy({
      id: 'universal-webhook',
      channel: 'webhook',
      commercialFamily: 'api',
      deploymentMode: 'server-to-server',
      requiresLocalAgent: false,
      adapter: 'universal-webhook',
      warnings,
      locale,
    });
  }

  if (boolean(input.canUploadFiles, 'canUploadFiles')) {
    return strategy({
      id: 'file-upload',
      channel: 'file_upload',
      commercialFamily: 'web',
      deploymentMode: 'kairoseth-web',
      requiresLocalAgent: false,
      adapter: 'file-import',
      warnings,
      locale,
    });
  }

  if (boolean(input.canReadDatabase, 'canReadDatabase')) {
    return strategy({
      id: 'local-agent-database',
      channel: 'database_read',
      commercialFamily: 'connect',
      deploymentMode: 'local-agent',
      requiresLocalAgent: true,
      sourceKind: 'database',
      adapter: 'local-agent',
      warnings,
      locale,
    });
  }

  if (boolean(input.canSftp, 'canSftp')) {
    return strategy({
      id: 'local-agent-sftp',
      channel: 'sftp',
      commercialFamily: 'connect',
      deploymentMode: 'local-agent',
      requiresLocalAgent: true,
      sourceKind: 'sftp',
      adapter: 'local-agent',
      warnings,
      locale,
    });
  }

  if (
    boolean(input.canWatchFolder, 'canWatchFolder')
    || boolean(input.isLocalApplication, 'isLocalApplication')
  ) {
    return strategy({
      id: 'local-agent-watch-folder',
      channel: 'watch_folder',
      commercialFamily: 'connect',
      deploymentMode: 'local-agent',
      requiresLocalAgent: true,
      sourceKind: 'watch-folder',
      adapter: 'local-agent',
      warnings,
      locale,
    });
  }

  return strategy({
    id: 'manual-capture',
    channel: 'manual',
    commercialFamily: 'web',
    deploymentMode: 'kairoseth-web',
    requiresLocalAgent: false,
    adapter: 'manual-capture',
    warnings,
    locale,
  });
}
