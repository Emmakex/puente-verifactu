import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createSecureContext } from 'node:tls';

function gateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function resolvePfxPassphrase(env = process.env, { readText = readFile } = {}) {
  const direct = env.AEAT_TEST_PFX_PASSPHRASE;
  const secretPath = String(env.AEAT_TEST_PFX_PASSPHRASE_FILE ?? '').trim();

  if (direct != null && secretPath) {
    throw gateError(
      'VF_AEAT_GATE_PFX_PASSPHRASE_AMBIGUOUS',
      'Configure only one PFX passphrase source',
    );
  }

  if (secretPath) {
    let secret;
    try {
      secret = await readText(secretPath, 'utf8');
    } catch {
      throw gateError(
        'VF_AEAT_GATE_PFX_PASSPHRASE_FILE_UNREADABLE',
        'The configured PFX passphrase file cannot be read',
      );
    }
    return {
      passphrase: String(secret).replace(/\r?\n$/, ''),
      source: 'file',
    };
  }

  if (direct != null) {
    return { passphrase: direct, source: 'environment' };
  }

  return { passphrase: undefined, source: 'none' };
}

export function validatePfxBuffer(
  pfx,
  passphrase,
  { createSecureContextFn = createSecureContext } = {},
) {
  if (!Buffer.isBuffer(pfx) || pfx.length === 0) {
    throw gateError('VF_AEAT_GATE_PFX_INVALID', 'The configured PFX is empty or invalid');
  }

  try {
    createSecureContextFn({ pfx, passphrase });
  } catch {
    throw gateError(
      'VF_AEAT_GATE_PFX_INVALID',
      'The configured PFX cannot be opened with the supplied passphrase',
    );
  }

  return {
    bytes: pfx.length,
    sha256: createHash('sha256').update(pfx).digest('hex'),
  };
}

export async function loadPfxCredentials(
  env = process.env,
  {
    readBinary = readFile,
    readText = readFile,
    createSecureContextFn = createSecureContext,
  } = {},
) {
  const pfxPath = String(env.AEAT_TEST_PFX_PATH ?? '').trim();
  if (!pfxPath) {
    throw gateError(
      'VF_AEAT_GATE_PFX_PATH_REQUIRED',
      'AEAT_TEST_PFX_PATH is required for certificate preflight',
    );
  }

  let pfx;
  try {
    pfx = await readBinary(pfxPath);
  } catch {
    throw gateError(
      'VF_AEAT_GATE_PFX_UNREADABLE',
      'The configured PFX file cannot be read',
    );
  }

  const { passphrase, source: passphraseSource } = await resolvePfxPassphrase(env, { readText });
  const fingerprint = validatePfxBuffer(pfx, passphrase, { createSecureContextFn });

  return {
    pfx,
    passphrase,
    summary: {
      schemaVersion: 1,
      status: 'ok',
      format: 'PKCS12/PFX',
      bytes: fingerprint.bytes,
      pfxSha256: fingerprint.sha256,
      passphraseSource,
      networkUsed: false,
      scope: 'container-and-passphrase-only',
    },
  };
}
