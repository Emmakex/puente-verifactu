import { formatAeatDate } from '../../core/src/hash.mjs';
import { composeFiscalNumber } from '../../core/src/fiscal-records.mjs';
import { AEAT_ARTIFACTS, AEAT_NAMESPACES } from './constants.mjs';
import { element, escapeXml } from './xml.mjs';

function yesNo(value) {
  return value ? 'S' : 'N';
}

function requireText(value, field, maxLength) {
  const text = String(value ?? '').trim();
  if (!text) throw Object.assign(new Error(`${field} is required`), { code: 'VF_AEAT_SERIALIZATION_REQUIRED', field });
  if (maxLength && text.length > maxLength) throw Object.assign(new Error(`${field} exceeds AEAT max length ${maxLength}`), { code: 'VF_AEAT_SERIALIZATION_LENGTH', field });
  return text;
}

function partyXml(party) {
  const name = requireText(party?.name, 'party.name', 120);
  const identity = party?.taxId
    ? element('sf', 'NIF', requireText(party.taxId, 'party.taxId', 20))
    : party?.otherId
      ? `<sf:IDOtro>${element('sf', 'CodigoPais', party.otherId.countryCode)}${element('sf', 'IDType', party.otherId.idType)}${element('sf', 'ID', requireText(party.otherId.id, 'party.otherId.id', 20))}</sf:IDOtro>`
      : (() => { throw Object.assign(new Error('Party needs taxId or otherId'), { code: 'VF_AEAT_PARTY_ID_REQUIRED' }); })();
  return `${element('sf', 'NombreRazon', name)}${identity}`;
}

function invoiceReferenceXml(ref, tagName) {
  if (!ref?.issueDate) throw Object.assign(new Error(`${tagName} requires issueDate for AEAT XML`), { code: 'VF_AEAT_REFERENCE_DATE_REQUIRED' });
  return `<sf:${tagName}>${element('sf', 'IDEmisorFactura', ref.issuerTaxId)}${element('sf', 'NumSerieFactura', composeFiscalNumber(ref))}${element('sf', 'FechaExpedicionFactura', formatAeatDate(ref.issueDate))}</sf:${tagName}>`;
}

function chainXml(record) {
  if (record.firstRecord) return '<sf:Encadenamiento><sf:PrimerRegistro>S</sf:PrimerRegistro></sf:Encadenamiento>';
  if (!record.previous) throw Object.assign(new Error('Non-first fiscal record must contain previous reference'), { code: 'VF_AEAT_CHAIN_REQUIRED' });
  return `<sf:Encadenamiento><sf:RegistroAnterior>${element('sf', 'IDEmisorFactura', record.previous.issuerTaxId)}${element('sf', 'NumSerieFactura', record.previous.fiscalNumber)}${element('sf', 'FechaExpedicionFactura', formatAeatDate(record.previous.issueDate))}${element('sf', 'Huella', record.previous.hash)}</sf:RegistroAnterior></sf:Encadenamiento>`;
}

function sifXml(sif, record) {
  if (String(record.sif?.systemId) !== String(sif.systemId) || String(record.sif?.installationNumber) !== String(sif.installationNumber)) {
    throw Object.assign(new Error('Fiscal record SIF identity differs from AEAT adapter configuration'), { code: 'VF_AEAT_SIF_IDENTITY_MISMATCH' });
  }
  const producerIdentity = sif.producerTaxId
    ? element('sf', 'NIF', sif.producerTaxId)
    : sif.producerOtherId
      ? `<sf:IDOtro>${element('sf', 'CodigoPais', sif.producerOtherId.countryCode)}${element('sf', 'IDType', sif.producerOtherId.idType)}${element('sf', 'ID', sif.producerOtherId.id)}</sf:IDOtro>`
      : (() => { throw Object.assign(new Error('SIF producer requires tax ID'), { code: 'VF_AEAT_SIF_PRODUCER_ID_REQUIRED' }); })();

  return `<sf:SistemaInformatico>${element('sf', 'NombreRazon', requireText(sif.producerName, 'sif.producerName', 120))}${producerIdentity}${element('sf', 'NombreSistemaInformatico', requireText(sif.softwareName, 'sif.softwareName', 30))}${element('sf', 'IdSistemaInformatico', requireText(sif.systemId, 'sif.systemId', 2))}${element('sf', 'Version', requireText(sif.version, 'sif.version', 50))}${element('sf', 'NumeroInstalacion', requireText(sif.installationNumber, 'sif.installationNumber', 100))}${element('sf', 'TipoUsoPosibleSoloVerifactu', yesNo(sif.onlyVerifactu !== false))}${element('sf', 'TipoUsoPosibleMultiOT', yesNo(Boolean(sif.possibleMultiTaxpayer)))}${element('sf', 'IndicadorMultiplesOT', yesNo(Boolean(sif.multipleTaxpayers)))}</sf:SistemaInformatico>`;
}

function taxDetailXml(line) {
  const operation = String(line.operationClass ?? '');
  const classification = operation.startsWith('E')
    ? element('sf', 'OperacionExenta', operation)
    : element('sf', 'CalificacionOperacion', operation);
  return `<sf:DetalleDesglose>${element('sf', 'Impuesto', line.taxCode)}${element('sf', 'ClaveRegimen', line.regimeKey)}${classification}${line.rate != null ? element('sf', 'TipoImpositivo', line.rate) : ''}${element('sf', 'BaseImponibleOimporteNoSujeto', line.baseAmount)}${['S1', 'S2'].includes(operation) ? element('sf', 'CuotaRepercutida', line.taxAmount) : ''}${line.surchargeRate != null ? element('sf', 'TipoRecargoEquivalencia', line.surchargeRate) : ''}${line.surchargeAmount != null ? element('sf', 'CuotaRecargoEquivalencia', line.surchargeAmount) : ''}</sf:DetalleDesglose>`;
}

function altaXml(entry, sif) {
  const { intent, record, delivery = {} } = entry;
  if (!intent) throw Object.assign(new Error('Alta serialization requires its InvoiceIntent'), { code: 'VF_AEAT_INTENT_REQUIRED' });
  if (record.invoice.fiscalNumber !== composeFiscalNumber(intent) || record.invoice.issuerTaxId !== intent.issuer.taxId) {
    throw Object.assign(new Error('InvoiceIntent and FiscalRecord identity mismatch'), { code: 'VF_AEAT_RECORD_INTENT_MISMATCH' });
  }
  if ((intent.adjustments ?? []).some((item) => item.type === 'surcharge') && !intent.taxBreakdown.some((line) => line.surchargeAmount != null)) {
    throw Object.assign(new Error('Equivalence surcharge needs line-level rate and amount before AEAT serialization'), { code: 'VF_AEAT_SURCHARGE_BREAKDOWN_REQUIRED' });
  }

  const refExternal = record.source?.sourceInvoiceId ? requireText(record.source.sourceInvoiceId, 'RefExterna', 60) : null;
  const rectificationType = intent.rectification ? element('sf', 'TipoRectificativa', intent.rectification.type) : '';
  const correctedInvoices = intent.rectification?.originalInvoices?.length
    ? `<sf:FacturasRectificadas>${intent.rectification.originalInvoices.map((ref) => invoiceReferenceXml({ ...ref, issuerTaxId: intent.issuer.taxId }, 'IDFacturaRectificada')).join('')}</sf:FacturasRectificadas>`
    : '';
  const replacedInvoices = intent.replacedInvoices?.length
    ? `<sf:FacturasSustituidas>${intent.replacedInvoices.map((ref) => invoiceReferenceXml({ ...ref, issuerTaxId: intent.issuer.taxId }, 'IDFacturaSustituida')).join('')}</sf:FacturasSustituidas>`
    : '';

  let rectificationAmounts = '';
  if (intent.rectification?.type === 'S') {
    if (intent.rectification.correctedBaseAmount == null || intent.rectification.correctedTaxAmount == null) {
      throw Object.assign(new Error('Substitutive rectification requires corrected base and tax amounts'), { code: 'VF_AEAT_RECTIFICATION_AMOUNTS_REQUIRED' });
    }
    rectificationAmounts = `<sf:ImporteRectificacion>${element('sf', 'BaseRectificada', intent.rectification.correctedBaseAmount)}${element('sf', 'CuotaRectificada', intent.rectification.correctedTaxAmount)}${intent.rectification.correctedSurchargeAmount != null ? element('sf', 'CuotaRecargoRectificado', intent.rectification.correctedSurchargeAmount) : ''}</sf:ImporteRectificacion>`;
  }

  const recipients = intent.recipients?.length
    ? `<sf:Destinatarios>${intent.recipients.map((party) => `<sf:IDDestinatario>${partyXml(party)}</sf:IDDestinatario>`).join('')}</sf:Destinatarios>`
    : '';

  return `<sf:RegistroAlta>${element('sf', 'IDVersion', AEAT_ARTIFACTS.recordVersion)}<sf:IDFactura>${element('sf', 'IDEmisorFactura', record.invoice.issuerTaxId)}${element('sf', 'NumSerieFactura', record.invoice.fiscalNumber)}${element('sf', 'FechaExpedicionFactura', formatAeatDate(record.invoice.issueDate))}</sf:IDFactura>${refExternal ? element('sf', 'RefExterna', refExternal) : ''}${element('sf', 'NombreRazonEmisor', intent.issuer.name)}${delivery.subsanacion != null ? element('sf', 'Subsanacion', yesNo(delivery.subsanacion)) : ''}${delivery.rechazoPrevio != null ? element('sf', 'RechazoPrevio', yesNo(delivery.rechazoPrevio)) : ''}${element('sf', 'TipoFactura', intent.invoiceType)}${rectificationType}${correctedInvoices}${replacedInvoices}${rectificationAmounts}${element('sf', 'DescripcionOperacion', intent.description)}${recipients}<sf:Desglose>${intent.taxBreakdown.map(taxDetailXml).join('')}</sf:Desglose>${element('sf', 'CuotaTotal', record.quotaTotal)}${element('sf', 'ImporteTotal', record.totalAmount)}${chainXml(record)}${sifXml(sif, record)}${element('sf', 'FechaHoraHusoGenRegistro', record.generatedAt)}${element('sf', 'TipoHuella', record.hashType)}${element('sf', 'Huella', record.hash)}</sf:RegistroAlta>`;
}

function anulacionXml(entry, sif) {
  const { record, delivery = {} } = entry;
  const refExternal = record.source?.sourceCancellationId ? requireText(record.source.sourceCancellationId, 'RefExterna', 60) : null;
  return `<sf:RegistroAnulacion>${element('sf', 'IDVersion', AEAT_ARTIFACTS.recordVersion)}<sf:IDFactura>${element('sf', 'IDEmisorFacturaAnulada', record.invoice.issuerTaxId)}${element('sf', 'NumSerieFacturaAnulada', record.invoice.fiscalNumber)}${element('sf', 'FechaExpedicionFacturaAnulada', formatAeatDate(record.invoice.issueDate))}</sf:IDFactura>${refExternal ? element('sf', 'RefExterna', refExternal) : ''}${delivery.sinRegistroPrevio != null ? element('sf', 'SinRegistroPrevio', yesNo(delivery.sinRegistroPrevio)) : ''}${delivery.rechazoPrevio != null ? element('sf', 'RechazoPrevio', yesNo(delivery.rechazoPrevio)) : ''}${chainXml(record)}${sifXml(sif, record)}${element('sf', 'FechaHoraHusoGenRegistro', record.generatedAt)}${element('sf', 'TipoHuella', record.hashType)}${element('sf', 'Huella', record.hash)}</sf:RegistroAnulacion>`;
}

export function serializeAeatSoapRequest({ issuer, representative, voluntary = {}, entries, sif }) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > AEAT_ARTIFACTS.maxRecordsPerRequest) {
    throw Object.assign(new Error(`AEAT request requires 1-${AEAT_ARTIFACTS.maxRecordsPerRequest} records`), { code: 'VF_AEAT_BATCH_SIZE_INVALID' });
  }
  const issuerTaxId = requireText(issuer?.taxId, 'issuer.taxId', 20);
  for (const entry of entries) {
    if (entry.record?.organizationId == null || entry.record.invoice?.issuerTaxId !== issuerTaxId) {
      throw Object.assign(new Error('Every record in an AEAT request must belong to the header issuer'), { code: 'VF_AEAT_BATCH_ISSUER_MISMATCH' });
    }
  }
  const header = `<lr:Cabecera><sf:ObligadoEmision>${element('sf', 'NombreRazon', requireText(issuer.name, 'issuer.name', 120))}${element('sf', 'NIF', issuerTaxId)}</sf:ObligadoEmision>${representative ? `<sf:Representante>${element('sf', 'NombreRazon', requireText(representative.name, 'representative.name', 120))}${element('sf', 'NIF', requireText(representative.taxId, 'representative.taxId', 20))}</sf:Representante>` : ''}${voluntary.endDate || voluntary.incident != null ? `<sf:RemisionVoluntaria>${voluntary.endDate ? element('sf', 'FechaFinVeriFactu', formatAeatDate(voluntary.endDate)) : ''}${voluntary.incident != null ? element('sf', 'Incidencia', yesNo(voluntary.incident)) : ''}</sf:RemisionVoluntaria>` : ''}</lr:Cabecera>`;
  const records = entries.map((entry) => `<lr:RegistroFactura>${entry.record.recordType === 'alta' ? altaXml(entry, sif) : anulacionXml(entry, sif)}</lr:RegistroFactura>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="${AEAT_NAMESPACES.soap}" xmlns:lr="${AEAT_NAMESPACES.ledger}" xmlns:sf="${AEAT_NAMESPACES.info}"><soapenv:Header/><soapenv:Body><lr:RegFactuSistemaFacturacion>${header}${records}</lr:RegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>`;
}

export function xmlSnippetForLog(xml, max = 200) {
  return escapeXml(String(xml ?? '').slice(0, max));
}
