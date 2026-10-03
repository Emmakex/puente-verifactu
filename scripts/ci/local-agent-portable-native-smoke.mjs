import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function fail(message) {
  throw new Error(message);
}

function parseJsonLines(stdout) {
  return String(stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const artifact = resolve(argValue('--artifact') || fail('--artifact is required'));
const checksumPath = resolve(argValue('--checksum') || `${artifact}.sha256`);
const bundleRoot = resolve(argValue('--bundle-root') || fail('--bundle-root is required'));
const expectedCommit = String(
  argValue('--source-commit') || process.env.PV_SOURCE_COMMIT || '',
).trim().toLowerCase();
const expectedPlatform = argValue('--platform') || process.env.PV_EXPECTED_PLATFORM || null;
const expectedArch = argValue('--arch') || process.env.PV_EXPECTED_ARCH || null;

if (!/^[0-9a-f]{40}$/.test(expectedCommit)) fail('full source commit is required');

const artifactBytes = await readFile(artifact);
const checksumLine = (await readFile(checksumPath, 'utf8')).trim();
const expectedSha = checksumLine.split(/\s+/)[0]?.toLowerCase();
const actualSha = sha256(artifactBytes);
if (!/^[0-9a-f]{64}$/.test(expectedSha)) fail('invalid SHA-256 sidecar');
if (expectedSha !== actualSha) fail('portable artifact SHA-256 mismatch');

const manifest = JSON.parse(await readFile(join(bundleRoot, 'bundle-manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 1) fail('bundle manifest schemaVersion mismatch');
if (manifest.product !== 'kairoseth-fiscal') fail('bundle product mismatch');
if (manifest.component !== 'local-agent') fail('bundle component mismatch');
if (manifest.artifactKind !== 'portable-source') fail('bundle artifactKind mismatch');
if (manifest.sourceCommit !== expectedCommit) fail('bundle source commit mismatch');
if (manifest.requiredNode !== '>=22.13.0') fail('bundle Node requirement mismatch');
if (manifest.architecture !== 'any-node22') fail('bundle architecture contract mismatch');
if (expectedPlatform && process.platform !== expectedPlatform) {
  fail(`unexpected platform: ${process.platform}, expected ${expectedPlatform}`);
}
if (expectedArch && process.arch !== expectedArch) {
  fail(`unexpected architecture: ${process.arch}, expected ${expectedArch}`);
}

const pkg = JSON.parse(await readFile(join(bundleRoot, 'package.json'), 'utf8'));
for (const [name, version] of Object.entries(manifest.runtimeDependencies)) {
  if (pkg.dependencies?.[name] !== version) fail(`package dependency mismatch for ${name}`);
  const installed = JSON.parse(
    await readFile(join(bundleRoot, 'node_modules', name, 'package.json'), 'utf8'),
  );
  if (installed.version !== version) {
    fail(`installed dependency mismatch for ${name}: ${installed.version} != ${version}`);
  }
}

const fixture = await mkdtemp(join(tmpdir(), 'pv-local-agent-portable-'));
const configPath = join(fixture, 'agent.json');
const dataDir = join(fixture, 'data');
const watchRoot = join(fixture, 'watch');
const apiKey = 'portable-smoke-key';

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/readyz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ready' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not-found' }));
});

await new Promise((resolvePromise, rejectPromise) => {
  server.once('error', rejectPromise);
  server.listen(0, '127.0.0.1', resolvePromise);
});

try {
  const address = server.address();
  if (!address || typeof address === 'string') fail('mock ready server did not bind a TCP port');

  const config = {
    schemaVersion: 1,
    installationId: `portable-${process.platform}-${process.arch}`,
    dataDir,
    bridge: {
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKeyEnv: 'PV_LOCAL_AGENT_API_KEY',
      allowInsecureLocalhost: true,
    },
    runtime: {
      pollIntervalMs: 1_000,
      workerBatchSize: 10,
      leaseMs: 60_000,
      maxAttempts: 3,
      terminalRedactionDelayMs: 0,
    },
    source: {
      kind: 'watch-folder',
      sourceId: 'portable-watch',
      profileId: 'portable-profile',
      root: watchRoot,
      issueEnabled: false,
      minAgeMs: 0,
      maxFileBytes: 1_048_576,
      maxRows: 100,
    },
  };

  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(configPath, 0o600);

  const cli = join(bundleRoot, 'bin', 'kairoseth-local-agent.mjs');
  const env = { ...process.env, PV_LOCAL_AGENT_API_KEY: apiKey };

  const statusRun = await execFileAsync(process.execPath, [cli, 'status', '--config', configPath], {
    cwd: bundleRoot,
    env,
    windowsHide: true,
  });
  const statusLines = parseJsonLines(statusRun.stdout);
  const status = statusLines.at(-1);
  if (status?.status !== 'ok') fail('portable status command failed');
  if (status?.sourceKind !== 'watch-folder') fail('portable status source mismatch');
  if (status?.issueEnabled !== false) fail('portable status must remain fail-closed');

  const doctorRun = await execFileAsync(process.execPath, [cli, 'doctor', '--config', configPath], {
    cwd: bundleRoot,
    env,
    windowsHide: true,
  });
  const doctorLines = parseJsonLines(doctorRun.stdout);
  const doctor = doctorLines.find((entry) => entry?.ok === true && entry?.status === 'ok');
  if (!doctor) fail('portable doctor command failed');
  if (!doctor.checks?.some((check) => check.name === 'bridge-ready' && check.ok === true)) {
    fail('portable doctor did not verify bridge readiness');
  }
  if (!doctor.checks?.some((check) => check.name === 'source-read-only' && check.ok === true)) {
    fail('portable doctor did not verify source capability');
  }

  console.log(JSON.stringify({
    schema_version: 1,
    status: 'ok',
    check: 'local-agent-portable-native',
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    source_commit: manifest.sourceCommit,
    artifact_sha256: actualSha,
    content_fingerprint: manifest.contentFingerprint,
    status_command: true,
    doctor_command: true,
    issue_enabled: false,
  }, null, 2));
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
