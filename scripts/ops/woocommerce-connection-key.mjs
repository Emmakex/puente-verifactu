import { stdin, stdout, stderr, argv, exit } from 'node:process';

const PROFILE_RE = /^int_[a-f0-9]{32}$/;

function argument(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] ?? '').trim() : '';
}

function fail(message) {
  stderr.write(`${message}\n`);
  exit(1);
}

const profileId = argument('--profile');
const refundProfileId = argument('--refund-profile');

if (!PROFILE_RE.test(profileId)) fail('--profile must be an int_<32 hex> IntegrationProfile id');
if (refundProfileId && !PROFILE_RE.test(refundProfileId)) fail('--refund-profile must be an int_<32 hex> IntegrationProfile id');
if (stdin.isTTY) fail('Read the scoped WooCommerce data-plane token from stdin; never pass it as a process argument');

const chunks = [];
for await (const chunk of stdin) chunks.push(chunk);
const token = Buffer.concat(chunks).toString('utf8').trim();
if (token.length < 32 || token.length > 2048 || /[\r\n]/.test(token)) fail('stdin does not contain a valid scoped data-plane token');

const payload = {
  v: 1,
  profileId,
  ...(refundProfileId ? { refundProfileId } : {}),
  token,
};

const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
stdout.write(`KFS1.${encoded}\n`);
