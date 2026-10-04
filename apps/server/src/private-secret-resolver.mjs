import { readFile } from 'node:fs/promises';

function invalid(message) {
  return Object.assign(new Error(message), {
    code: 'VF_KAIROSETH_SECRET_CONFIG_INVALID',
  });
}

export async function loadPrivateSecretResolver(path) {
  const configuredPath = String(path ?? '').trim();
  if (!configuredPath) {
    return async () => null;
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(configuredPath, 'utf8'));
  } catch {
    throw invalid('Private integration secret configuration is unreadable or invalid JSON');
  }
  const values = parsed?.secrets;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw invalid('Private integration secret configuration must contain a secrets object');
  }

  const secrets = new Map();
  for (const [ref, value] of Object.entries(values)) {
    const key = String(ref).trim();
    const secret = String(value ?? '');
    if (!/^[A-Za-z0-9._:/-]{1,200}$/.test(key) || secret.length < 16) {
      throw invalid('Private integration secret configuration contains an invalid reference or secret');
    }
    secrets.set(key, secret);
  }

  return async ({ ref }) => secrets.get(String(ref ?? '').trim()) ?? null;
}
