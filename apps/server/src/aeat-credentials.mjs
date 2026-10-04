import { readFile } from 'node:fs/promises';
import { createSecureContext } from 'node:tls';

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

async function readPassphrase(env) {
  const direct = env.PV_AEAT_PFX_PASSPHRASE;
  const file = String(env.PV_AEAT_PFX_PASSPHRASE_FILE ?? '').trim();
  if (direct != null && file) {
    throw fail(
      'VF_AEAT_PFX_PASSPHRASE_AMBIGUOUS',
      'Configure only one AEAT PFX passphrase source',
    );
  }
  if (file) {
    try {
      return String(await readFile(file, 'utf8')).replace(/\r?\n$/, '');
    } catch {
      throw fail('VF_AEAT_PFX_PASSPHRASE_UNREADABLE', 'AEAT PFX passphrase file cannot be read');
    }
  }
  return direct;
}

export async function loadRuntimeAeatTls(env = process.env) {
  const pfxPath = String(env.PV_AEAT_PFX_PATH ?? '').trim();
  if (!pfxPath) {
    throw fail('VF_AEAT_PFX_PATH_REQUIRED', 'PV_AEAT_PFX_PATH is required');
  }
  let pfx;
  try {
    pfx = await readFile(pfxPath);
  } catch {
    throw fail('VF_AEAT_PFX_UNREADABLE', 'AEAT PFX file cannot be read');
  }
  const passphrase = await readPassphrase(env);
  try {
    createSecureContext({ pfx, passphrase });
  } catch {
    throw fail('VF_AEAT_PFX_INVALID', 'AEAT PFX cannot be opened with the supplied passphrase');
  }
  return Object.freeze({ pfx, passphrase });
}
