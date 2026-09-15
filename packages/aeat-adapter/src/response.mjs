import { firstLocalText, localBlocks, rejectUnsafeXml } from './xml.mjs';

function normalizeRecordStatus(value) {
  if (value === 'Correcto') return 'accepted';
  if (value === 'AceptadoConErrores') return 'accepted_with_errors';
  if (value === 'Incorrecto') return 'rejected';
  return 'unknown';
}

function normalizeGlobalStatus(value) {
  if (value === 'Correcto') return 'accepted';
  if (value === 'ParcialmenteCorrecto') return 'partial';
  if (value === 'Incorrecto') return 'rejected';
  return 'unknown';
}

export function parseAeatSoapResponse(xml) {
  const safe = rejectUnsafeXml(xml);
  const faultBlocks = localBlocks(safe, 'Fault');
  if (faultBlocks.length) {
    const fault = faultBlocks[0];
    const faultString = firstLocalText(fault, 'faultstring') ?? 'SOAP Fault';
    const codeMatch = faultString.match(/Codigo\[(\d+)\]/i);
    return {
      kind: 'soap_fault',
      status: 'fault',
      retryable: true,
      errorCode: codeMatch?.[1] ?? null,
      message: faultString,
      waitSeconds: null,
      records: [],
    };
  }

  const globalRaw = firstLocalText(safe, 'EstadoEnvio');
  if (!globalRaw) {
    const error = new Error('AEAT response does not contain EstadoEnvio or SOAP Fault');
    error.code = 'VF_AEAT_RESPONSE_UNRECOGNIZED';
    throw error;
  }

  const lineBlocks = localBlocks(safe, 'RespuestaLinea');
  const records = lineBlocks.map((block) => {
    const stateRaw = firstLocalText(block, 'EstadoRegistro');
    return {
      status: normalizeRecordStatus(stateRaw),
      stateRaw,
      operation: firstLocalText(block, 'TipoOperacion'),
      externalReference: firstLocalText(block, 'RefExterna'),
      errorCode: firstLocalText(block, 'CodigoErrorRegistro'),
      errorDescription: firstLocalText(block, 'DescripcionErrorRegistro'),
      duplicate: localBlocks(block, 'RegistroDuplicado').length > 0,
      duplicateRequestId: firstLocalText(block, 'IdPeticionRegistroDuplicado'),
      duplicateState: firstLocalText(block, 'EstadoRegistroDuplicado'),
    };
  });

  const waitRaw = firstLocalText(safe, 'TiempoEsperaEnvio');
  const waitSeconds = waitRaw != null && /^\d+$/.test(waitRaw) ? Number(waitRaw) : null;
  const status = normalizeGlobalStatus(globalRaw);
  return {
    kind: 'aeat_response',
    status,
    retryable: false,
    globalStateRaw: globalRaw,
    csv: firstLocalText(safe, 'CSV'),
    presenterTaxId: firstLocalText(safe, 'NIFPresentador'),
    presentedAt: firstLocalText(safe, 'TimestampPresentacion'),
    waitSeconds,
    records,
    needsCorrection: records.some((item) => item.status === 'accepted_with_errors' || item.status === 'rejected'),
  };
}
