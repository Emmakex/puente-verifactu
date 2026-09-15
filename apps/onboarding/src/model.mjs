export const TARGET_LABELS = Object.freeze({
  number: { es: 'Número de factura', en: 'Invoice number' },
  series: { es: 'Serie', en: 'Series' },
  issueDate: { es: 'Fecha de expedición', en: 'Issue date' },
  invoiceType: { es: 'Tipo de factura', en: 'Invoice type' },
  description: { es: 'Concepto / descripción', en: 'Description' },
  'recipients.0.taxId': { es: 'NIF/CIF del cliente', en: 'Customer tax ID' },
  'recipients.0.name': { es: 'Nombre / razón social del cliente', en: 'Customer name' },
  'taxBreakdown.0.baseAmount': { es: 'Base imponible', en: 'Tax base' },
  'taxBreakdown.0.rate': { es: 'Tipo de IVA (%)', en: 'VAT rate (%)' },
  'taxBreakdown.0.taxAmount': { es: 'Cuota de IVA', en: 'VAT amount' },
  'taxBreakdown.0.surchargeRate': { es: 'Tipo recargo equivalencia (%)', en: 'Equivalence surcharge rate (%)' },
  'taxBreakdown.0.surchargeAmount': { es: 'Cuota recargo equivalencia', en: 'Equivalence surcharge amount' },
  'totals.totalAmount': { es: 'Total factura', en: 'Invoice total' },
  sourceInvoiceId: { es: 'ID externo de factura', en: 'External invoice ID' },
});

export const FIXED_FIELDS = Object.freeze([
  { path: 'issuer.name', label: { es: 'Nombre o razón social', en: 'Business / legal name' }, required: true, type: 'text' },
  { path: 'issuer.taxId', label: { es: 'NIF/CIF del emisor', en: 'Issuer tax ID' }, required: true, type: 'text' },
  { path: 'currency', label: { es: 'Moneda', en: 'Currency' }, required: true, type: 'select', options: ['EUR'], defaultValue: 'EUR' },
  { path: 'taxBreakdown.0.taxCode', label: { es: 'Impuesto', en: 'Tax' }, required: true, type: 'text', defaultValue: '01' },
  { path: 'taxBreakdown.0.regimeKey', label: { es: 'Clave de régimen', en: 'Regime key' }, required: true, type: 'text', defaultValue: '01' },
  { path: 'taxBreakdown.0.operationClass', label: { es: 'Clasificación de operación', en: 'Operation classification' }, required: true, type: 'select', options: ['S1', 'S2', 'N1', 'N2', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6'] },
  { path: 'invoiceType', label: { es: 'Tipo de factura fijo (si no viene en archivo)', en: 'Fixed invoice type (if absent from file)' }, required: false, type: 'select', options: ['', 'F1', 'F2', 'F3', 'R1', 'R2', 'R3', 'R4', 'R5'] },
  { path: 'description', label: { es: 'Descripción fija (si no viene en archivo)', en: 'Fixed description (if absent from file)' }, required: false, type: 'text' },
  { path: 'taxBreakdown.0.rate', label: { es: 'Tipo de IVA fijo (%)', en: 'Fixed VAT rate (%)' }, required: false, type: 'text' },
]);

export const COPY = Object.freeze({
  es: {
    principle: 'Principio Camaleón',
    title: 'Conecta tus facturas',
    subtitle: 'Usa el Excel o CSV que ya tienes. Puente VeriFactu te ayuda a encajar las columnas sin enviar nada a AEAT.',
    uploadTitle: '1. Sube tu archivo',
    uploadHelp: 'CSV o XLSX. No modifiques tu plantilla para adaptarte al puente.',
    chooseFile: 'Elegir archivo',
    maxFile: 'CSV · XLSX · máx. 5 MB',
    sheet: 'Hoja',
    mappingTitle: '2. Confirma las columnas',
    source: 'Tu columna',
    destination: 'Qué significa',
    confidence: 'Detección',
    confirm: 'Confirmar',
    auto: 'Automático',
    review: 'Revisar',
    unmatched: 'Sin identificar',
    ignore: 'No usar esta columna',
    configTitle: '3. Datos que se guardan una sola vez',
    configHelp: 'Estos datos normalmente no cambian factura a factura.',
    validate: '4. Validar sin enviar',
    validateHelp: 'Comprobamos todas las filas y te indicamos qué corregir. Este paso no contacta con AEAT.',
    validateButton: 'Validar archivo',
    valid: 'válidas',
    invalid: 'con errores',
    rows: 'filas',
    columns: 'columnas',
    row: 'Fila',
    loading: 'Analizando archivo…',
    ready: 'Archivo analizado. Revisa las equivalencias antes de validar.',
    success: 'El archivo ha superado el preflight.',
    failure: 'Hay filas que necesitan corrección.',
    retry: 'Vuelve a revisar las columnas o los datos indicados.',
    sessionExpired: 'La sesión de importación ha caducado. Vuelve a cargar el archivo.',
    confirmReviews: 'Confirma o ignora las equivalencias marcadas para revisar.',
    requiredData: 'Completa los datos obligatorios del negocio.',
    validating: 'Validando…',
  },
  en: {
    principle: 'Chameleon Principle',
    title: 'Connect your invoices',
    subtitle: 'Use the Excel or CSV you already have. Puente VeriFactu helps map columns without sending anything to AEAT.',
    uploadTitle: '1. Upload your file',
    uploadHelp: 'CSV or XLSX. Do not change your template to fit the bridge.',
    chooseFile: 'Choose file',
    maxFile: 'CSV · XLSX · max. 5 MB',
    sheet: 'Sheet',
    mappingTitle: '2. Confirm columns',
    source: 'Your column',
    destination: 'Meaning',
    confidence: 'Detection',
    confirm: 'Confirm',
    auto: 'Automatic',
    review: 'Review',
    unmatched: 'Unidentified',
    ignore: 'Ignore this column',
    configTitle: '3. Data saved once',
    configHelp: 'These values normally stay the same across invoices.',
    validate: '4. Validate without sending',
    validateHelp: 'We check every row and tell you what needs fixing. This step does not contact AEAT.',
    validateButton: 'Validate file',
    valid: 'valid',
    invalid: 'with errors',
    rows: 'rows',
    columns: 'columns',
    row: 'Row',
    loading: 'Analyzing file…',
    ready: 'File analyzed. Review the mappings before validation.',
    success: 'The file passed preflight.',
    failure: 'Some rows need correction.',
    retry: 'Review the column mappings or the indicated data.',
    sessionExpired: 'The import session expired. Upload the file again.',
    confirmReviews: 'Confirm or ignore the mappings marked for review.',
    requiredData: 'Complete the required business data.',
    validating: 'Validating…',
  },
});

export function initialSelections(inspection) {
  const suggestions = new Map((inspection?.assistant?.suggestions ?? []).map((item) => [item.source, item]));
  const automatic = inspection?.assistant?.profile?.fields ?? {};
  return (inspection?.headers ?? []).map((source) => {
    const suggestion = suggestions.get(source);
    const target = automatic[source] ?? suggestion?.target ?? '';
    return {
      source,
      target,
      status: suggestion?.status ?? 'unmatched',
      confidence: suggestion?.confidence ?? null,
      confirmed: suggestion?.status === 'auto',
    };
  });
}

export function configurationDefaults() {
  return Object.fromEntries(FIXED_FIELDS.filter((field) => field.defaultValue !== undefined).map((field) => [field.path, field.defaultValue]));
}

export function preflightPayload(selections, configuration) {
  const overrides = {};
  for (const selection of selections ?? []) {
    if (selection.status === 'auto' || selection.confirmed) overrides[selection.source] = selection.target ?? '';
  }
  const cleanConfiguration = Object.fromEntries(Object.entries(configuration ?? {}).filter(([, value]) => String(value ?? '').trim() !== ''));
  return { overrides, configuration: cleanConfiguration };
}

export function missingRequiredConfiguration(configuration) {
  return FIXED_FIELDS
    .filter((field) => field.required && !String(configuration?.[field.path] ?? '').trim())
    .map((field) => field.path);
}

export function targetLabel(target, locale = 'es') {
  return TARGET_LABELS[target]?.[locale] ?? target;
}
