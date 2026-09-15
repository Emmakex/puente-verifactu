export const AEAT_NAMESPACES = Object.freeze({
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  ledger: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd',
  info: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd',
  response: 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd',
});

export const AEAT_ENDPOINTS = Object.freeze({
  test: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  testSeal: 'https://prewww10.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  production: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
  productionSeal: 'https://www10.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP',
});

export const AEAT_ARTIFACTS = Object.freeze({
  verifiedAt: '2026-09-15',
  webServiceDocumentVersion: '1.0.3',
  validationsDocumentVersion: '1.2.2',
  schemaGeneration: 'tikeV1.0',
  recordVersion: '1.0',
  maxRecordsPerRequest: 1000,
  wsdl: 'https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SistemaFacturacion.wsdl',
  schemas: Object.freeze({
    ledger: 'https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroLR.xsd',
    common: 'https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroInformacion.xsd',
    response: 'https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/RespuestaSuministro.xsd',
  }),
});

export const AEAT_SOAP_ACTION = '';
