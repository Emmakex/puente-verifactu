import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runConnectorContractSuite } from './suite.mjs';

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) result[token.slice(2)] = argv[index += 1];
  }
  return result;
}

function fail(code, message, details = {}) {
  const diagnostic = {
    schema_version: 1,
    pipeline: 'connector-contract-suite',
    step: 'cli',
    exit_code: 1,
    primary_error: code,
    message,
    details,
    root_cause_status: 'confirmed',
  };
  console.error(JSON.stringify(diagnostic, null, 2));
  process.exit(1);
}

const options = args(process.argv.slice(2));
if (!options.module) {
  fail('VF_CONTRACT_MODULE_REQUIRED', 'Usage: cli.mjs --module <contract-adapter.mjs>');
}

let target;
try {
  target = await import(pathToFileURL(resolve(options.module)).href);
} catch (error) {
  fail('VF_CONTRACT_MODULE_LOAD_FAILED', error.message, { module: options.module });
}

const createConnector = target.createConnectorUnderTest ?? target.createConnector ?? target.default;
if (typeof createConnector !== 'function') {
  fail('VF_CONTRACT_FACTORY_EXPORT_MISSING', 'Module must export createConnectorUnderTest, createConnector, or a default factory');
}

const report = await runConnectorContractSuite({
  createConnector,
  sampleSource: target.sampleSource,
  profileId: target.profileId,
  sourceName: target.sourceName,
});

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
