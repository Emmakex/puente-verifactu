import { AEAT_ARTIFACTS, AEAT_NAMESPACES } from './constants.mjs';
import { element, firstLocalText, localBlocks, rejectUnsafeXml } from './xml.mjs';

function requiredText(value, field, maxLength) {
  const text = String(value ?? '').trim();
  if (!text) throw Object.assign(new Error(`${field} is required`), { code: 'VF_AEAT_QUERY_REQUIRED', field });
  if (maxLength && text.length > maxLength) {
    throw Object.assign(new Error(`${field} exceeds AEAT max length ${maxLength}`), { code: 'VF_AEAT_QUERY_LENGTH', field });
  }
  return text;
}

function normalizeStoredState(value) {
  if (value === 'Correcto') return 'accepted';
  if (value === 'AceptadoConErrores') return 'accepted_with_errors';
  if (value === 'Anulado' || value === 'Anulada') return 'cancelled';
  return 'unknown';
}

function queryFault(xml) {
  const faults = localBlocks(xml, 'Fault');
  if (!faults.length) return null;
  const message = firstLocalText(faults[0], 'faultstring') ?? 'SOAP Fault';
  const code = message.match(/Codigo\[(\d+)\]/i)?.[1] ?? null;
  return {
    kind: 'soap_fault',
    status: 'fault',
    retryable: true,
    errorCode: code,
    message,
    records: [],
    pagination: false,
    pageKey: null,
  };
}

export function periodFromDate(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw Object.assign(new Error('AEAT reconciliation date must use YYYY-MM-DD'), { code: 'VF_AEAT_QUERY_DATE_INVALID', field: 'date' });
  }
  return { year: match[1], period: match[2] };
}

export function serializeAeatQueryRequest({ issuer, period, refExternal, pageKey = null }) {
  const issuerName = requiredText(issuer?.name, 'issuer.name', 120);
  const issuerTaxId = requiredText(issuer?.taxId, 'issuer.taxId', 20);
  const year = requiredText(period?.year, 'period.year', 4);
  const month = requiredText(period?.period, 'period.period', 2);
  const reference = requiredText(refExternal, 'refExternal', 60);
  if (!/^\d{4}$/.test(year)) {
    throw Object.assign(new Error('period.year must use YYYY'), { code: 'VF_AEAT_QUERY_PERIOD_INVALID', field: 'period.year' });
  }
  if (!/^(0[1-9]|1[0-2])$/.test(month)) {
    throw Object.assign(new Error('period.period must use 01-12'), { code: 'VF_AEAT_QUERY_PERIOD_INVALID', field: 'period.period' });
  }

  const header = `<con:Cabecera>${element('sf', 'IDVersion', AEAT_ARTIFACTS.recordVersion)}<sf:ObligadoEmision>${element('sf', 'NombreRazon', issuerName)}${element('sf', 'NIF', issuerTaxId)}</sf:ObligadoEmision></con:Cabecera>`;
  const filter = `<con:FiltroConsulta><con:PeriodoImputacion>${element('sf', 'Ejercicio', year)}${element('sf', 'Periodo', month)}</con:PeriodoImputacion>${element('con', 'RefExterna', reference)}${pageKey ? `<con:ClavePaginacion>${element('sf', 'IDEmisorFactura', requiredText(pageKey.issuerTaxId, 'pageKey.issuerTaxId', 20))}${element('sf', 'NumSerieFactura', requiredText(pageKey.fiscalNumber, 'pageKey.fiscalNumber', 60))}${element('sf', 'FechaExpedicionFactura', requiredText(pageKey.issueDate, 'pageKey.issueDate', 10))}</con:ClavePaginacion>` : ''}</con:FiltroConsulta>`;
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="${AEAT_NAMESPACES.soap}" xmlns:con="${AEAT_NAMESPACES.query}" xmlns:sf="${AEAT_NAMESPACES.info}"><soapenv:Header/><soapenv:Body><con:ConsultaFactuSistemaFacturacion>${header}${filter}</con:ConsultaFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>`;
}

function parseRecord(block) {
  const invoiceBlock = localBlocks(block, 'IDFactura')[0] ?? '';
  const dataBlock = localBlocks(block, 'DatosRegistroFacturacion')[0] ?? '';
  const presentationBlock = localBlocks(block, 'DatosPresentacion')[0] ?? '';
  const timestampMarker = 'TimestampUltimaModificacion';
  const markerIndex = block.indexOf(timestampMarker);
  const stateTail = markerIndex >= 0 ? block.slice(markerIndex) : block;
  const stateRaw = firstLocalText(stateTail, 'EstadoRegistro');
  return {
    issuerTaxId: firstLocalText(invoiceBlock, 'IDEmisorFactura'),
    fiscalNumber: firstLocalText(invoiceBlock, 'NumSerieFactura'),
    issueDate: firstLocalText(invoiceBlock, 'FechaExpedicionFactura'),
    refExternal: firstLocalText(dataBlock, 'RefExterna'),
    invoiceType: firstLocalText(dataBlock, 'TipoFactura'),
    hashType: firstLocalText(dataBlock, 'TipoHuella'),
    hash: firstLocalText(dataBlock, 'Huella'),
    generatedAt: firstLocalText(dataBlock, 'FechaHoraHusoGenRegistro'),
    presenterTaxId: firstLocalText(presentationBlock, 'NIFPresentador'),
    presentedAt: firstLocalText(presentationBlock, 'TimestampPresentacion'),
    requestId: firstLocalText(presentationBlock, 'IdPeticion'),
    lastModifiedAt: firstLocalText(stateTail, 'TimestampUltimaModificacion'),
    storedStateRaw: stateRaw,
    storedState: normalizeStoredState(stateRaw),
    errorCode: firstLocalText(stateTail, 'CodigoErrorRegistro'),
    errorDescription: firstLocalText(stateTail, 'DescripcionErrorRegistro'),
  };
}

export function parseAeatQueryResponse(xml) {
  const safe = rejectUnsafeXml(xml);
  const fault = queryFault(safe);
  if (fault) return fault;

  const resultRaw = firstLocalText(safe, 'ResultadoConsulta');
  if (!resultRaw) {
    const error = new Error('AEAT query response does not contain ResultadoConsulta or SOAP Fault');
    error.code = 'VF_AEAT_QUERY_RESPONSE_UNRECOGNIZED';
    throw error;
  }
  const paginationRaw = firstLocalText(safe, 'IndicadorPaginacion');
  const pageKeyBlock = localBlocks(safe, 'ClavePaginacion')[0] ?? '';
  const pageKey = pageKeyBlock ? {
    issuerTaxId: firstLocalText(pageKeyBlock, 'IDEmisorFactura'),
    fiscalNumber: firstLocalText(pageKeyBlock, 'NumSerieFactura'),
    issueDate: firstLocalText(pageKeyBlock, 'FechaExpedicionFactura'),
  } : null;
  const records = localBlocks(safe, 'RegistroRespuestaConsultaFactuSistemaFacturacion').map(parseRecord);
  if (records.length > AEAT_ARTIFACTS.maxQueryRecordsPerResponse) {
    const error = new Error('AEAT query returned more records than the official response limit');
    error.code = 'VF_AEAT_QUERY_RESPONSE_LIMIT';
    throw error;
  }

  return {
    kind: 'aeat_query_response',
    status: resultRaw === 'ConDatos' ? 'found' : resultRaw === 'SinDatos' ? 'not_found' : 'unknown',
    retryable: false,
    resultRaw,
    period: {
      year: firstLocalText(safe, 'Ejercicio'),
      period: firstLocalText(safe, 'Periodo'),
    },
    pagination: paginationRaw === 'S',
    pageKey,
    records,
  };
}
