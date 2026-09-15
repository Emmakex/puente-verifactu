import { randomBytes } from 'node:crypto';
import { hashBasicPassword, hashBearerToken } from '../../apps/server/src/auth.mjs';

function args(argv) {
  const result = { type: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--username') result.username = argv[index += 1];
  }
  return result;
}

async function stdinSecret() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const value = Buffer.concat(chunks).toString('utf8').replace(/[\r\n]+$/, '');
  if (!value) throw new Error('Secret must be provided through stdin');
  return value;
}

const options = args(process.argv.slice(2));
if (!['bearer', 'basic'].includes(options.type)) {
  console.error('Usage: hash-credential.mjs <bearer|basic> [--username <user>] < secret-from-stdin');
  process.exit(2);
}

try {
  const secret = await stdinSecret();
  if (options.type === 'bearer') {
    console.log(JSON.stringify({ type: 'bearer', tokenSha256: hashBearerToken(secret) }, null, 2));
  } else {
    if (!options.username) throw new Error('--username is required for basic credentials');
    const passwordSalt = randomBytes(16).toString('hex');
    console.log(JSON.stringify({
      type: 'basic',
      username: options.username,
      passwordSalt,
      passwordScrypt: hashBasicPassword(secret, passwordSalt),
    }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({
    schema_version: 1,
    exit_code: 1,
    primary_error: 'VF_AUTH_HASH_FAILED',
    message: error.message,
    root_cause_status: 'confirmed',
  }, null, 2));
  process.exit(1);
}
