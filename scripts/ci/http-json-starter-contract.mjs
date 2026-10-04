import { readFileSync } from 'node:fs';

const paths = {
  readme: 'examples/http-json-starter/README.md',
  node: 'examples/http-json-starter/node/client.mjs',
  python: 'examples/http-json-starter/python/client.py',
  php: 'examples/http-json-starter/php/client.php',
  curl: 'examples/http-json-starter/curl.sh',
};

const sources = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, readFileSync(path, 'utf8')]),
);

const failures = [];
const expect = (condition, code) => {
  if (!condition) failures.push({ code });
};

for (const [name, source] of Object.entries(sources)) {
  expect(source.includes('PUENTE_BASE_URL'), `STARTER_${name.toUpperCase()}_BASE_URL_ENV_REQUIRED`);
  expect(source.includes('PUENTE_TOKEN'), `STARTER_${name.toUpperCase()}_TOKEN_ENV_REQUIRED`);
}

for (const [name, source] of Object.entries({
  node: sources.node,
  python: sources.python,
  php: sources.php,
  curl: sources.curl,
})) {
  expect(source.includes('/v1/preflight'), `STARTER_${name.toUpperCase()}_PREFLIGHT_REQUIRED`);
  expect(source.includes('/v1/fiscal-records'), `STARTER_${name.toUpperCase()}_ISSUE_REQUIRED`);
  expect(source.includes('/status'), `STARTER_${name.toUpperCase()}_STATUS_REQUIRED`);
  expect(source.includes('/cancel'), `STARTER_${name.toUpperCase()}_CANCEL_REQUIRED`);
  expect(/idempotency/i.test(source), `STARTER_${name.toUpperCase()}_IDEMPOTENCY_REQUIRED`);

  for (const forbidden of [
    'prewww2.aeat.es',
    'www1.agenciatributaria.gob.es',
    'BEGIN PRIVATE KEY',
    'BEGIN CERTIFICATE',
    'PKCS12',
    '<soap',
    '<RegistroAlta',
  ]) {
    expect(!source.includes(forbidden), `STARTER_${name.toUpperCase()}_FORBIDDEN_${forbidden.replace(/[^A-Za-z0-9]+/g, '_')}`);
  }

  for (const fiscalRule of ['taxCode', 'regimeKey', 'operationClass', 'TipoHuella']) {
    expect(!source.includes(fiscalRule), `STARTER_${name.toUpperCase()}_MUST_NOT_OWN_FISCAL_RULE_${fiscalRule}`);
  }
}

expect(
  sources.node.includes("command === 'issue' || command === 'rectify'")
    && sources.python.includes('command in ("issue", "rectify")')
    && sources.php.includes("$command === 'issue' || $command === 'rectify'")
    && sources.curl.includes('issue|rectify)'),
  'STARTER_RECTIFICATION_MUST_REUSE_ISSUE_ROUTE',
);

expect(
  sources.readme.includes('../api-lifecycle/create.json')
    && sources.readme.includes('../api-lifecycle/rectification.json')
    && sources.readme.includes('../api-lifecycle/cancel.json'),
  'STARTER_MUST_REUSE_CANONICAL_API_LIFECYCLE_EXAMPLES',
);

expect(
  sources.python.includes('from urllib import error, parse, request')
    && !sources.python.includes('import requests'),
  'STARTER_PYTHON_STDLIB_ONLY',
);

expect(
  sources.php.includes('curl_init')
    && sources.php.includes('rawurlencode'),
  'STARTER_PHP_CURL_AND_URL_ENCODING_REQUIRED',
);

expect(
  sources.node.includes('encodeURIComponent(recordId)')
    && sources.python.includes("parse.quote(record_id, safe='')")
    && sources.php.includes('rawurlencode($recordId)'),
  'STARTER_RECORD_ID_URL_ENCODING_REQUIRED',
);

if (failures.length > 0) {
  console.error(JSON.stringify({
    schema_version: 1,
    status: 'failed',
    check: 'http-json-starter-kits-v1',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  schema_version: 1,
  status: 'ok',
  check: 'http-json-starter-kits-v1',
  languages: ['node', 'python', 'php', 'curl'],
  lifecycle: ['preflight', 'issue', 'status', 'rectify', 'cancel'],
  server_side_fiscal_rules: true,
  hardcoded_aeat_transport: false,
  embedded_credentials: false,
}, null, 2));
