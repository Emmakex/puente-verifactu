export const SOURCE_OPTIONS = Object.freeze([
  { id: 'woocommerce', label: { es: 'WooCommerce', en: 'WooCommerce' }, capabilities: { nativeConnector: 'woocommerce' } },
  { id: 'prestashop', label: { es: 'PrestaShop', en: 'PrestaShop' }, capabilities: { nativeConnector: 'prestashop' } },
  { id: 'erp_crm_api', label: { es: 'ERP, CRM o software con API', en: 'ERP, CRM or software with API' }, capabilities: { hasApi: true } },
  { id: 'webhook', label: { es: 'Software que puede enviar webhooks', en: 'Software that can send webhooks' }, capabilities: { canWebhook: true } },
  { id: 'excel_csv', label: { es: 'Excel o CSV', en: 'Excel or CSV' }, capabilities: { canUploadFiles: true } },
  { id: 'database', label: { es: 'ERP o programa con base de datos accesible', en: 'ERP or application with accessible database' }, capabilities: { canReadDatabase: true } },
  { id: 'sftp', label: { es: 'Ficheros disponibles por SFTP', en: 'Files available over SFTP' }, capabilities: { canSftp: true } },
  { id: 'local_app', label: { es: 'Programa instalado que exporta ficheros', en: 'Installed application that exports files' }, capabilities: { isLocalApplication: true, canWatchFolder: true } },
  { id: 'manual', label: { es: 'No lo sé / introducir facturas manualmente', en: 'Not sure / enter invoices manually' }, capabilities: {} },
]);

export function capabilitiesForSource(sourceId, locale = 'es') {
  const source = SOURCE_OPTIONS.find((item) => item.id === sourceId);
  if (!source) throw new TypeError('Unsupported onboarding source');
  return Object.freeze({ locale, ...source.capabilities });
}

export function visualRecommendation(strategy, locale = 'es') {
  if (!strategy || typeof strategy !== 'object') throw new TypeError('strategy is required');
  const copy = strategy.copy?.[locale] ?? strategy.copy?.es ?? strategy.copy?.en ?? {};
  return Object.freeze({
    strategyId: strategy.strategyId,
    title: copy.title ?? strategy.channel,
    summary: copy.summary ?? '',
    channel: strategy.channel,
    requiresLocalAgent: Boolean(strategy.requiresLocalAgent),
    nextSteps: [...(strategy.nextSteps ?? [])],
    warnings: [...(strategy.warnings ?? [])],
  });
}
