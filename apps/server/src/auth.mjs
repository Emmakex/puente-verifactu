import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ALLOWED_PERMISSIONS = new Set(['ops:read']);

function authError(code, message = 'Unauthorized') {
  return Object.assign(new Error(message), { code, status: 401 });
}

function header(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function validHex(value, bytes) {
  return typeof value === 'string' && new RegExp(`^[a-f0-9]{${bytes * 2}}$`, 'i').test(value);
}

function safeHexEqual(left, right) {
  if (!validHex(left, left?.length / 2) || !validHex(right, right?.length / 2) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function normalizePermissions(value, prefix) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${prefix}.permissions must be an array`);
  const unique = new Set();
  for (const permission of value) {
    if (typeof permission !== 'string' || !ALLOWED_PERMISSIONS.has(permission)) {
      throw new TypeError(`${prefix}.permissions contains unsupported permission: ${String(permission)}`);
    }
    unique.add(permission);
  }
  return Object.freeze([...unique].sort());
}

function contextFor(credential) {
  return Object.freeze({
    credentialId: credential.id,
    organizationId: credential.organizationId,
    installationId: credential.installationId,
    sourceSystem: credential.sourceSystem,
    authType: credential.type,
    rateLimitPerMinute: credential.rateLimitPerMinute,
    permissions: credential.permissions,
  });
}

function validateCredential(credential, index) {
  const prefix = `credentials[${index}]`;
  for (const field of ['id', 'type', 'organizationId', 'installationId', 'sourceSystem']) {
    if (!credential?.[field] || typeof credential[field] !== 'string') throw new TypeError(`${prefix}.${field} is required`);
  }
  if (!['bearer', 'basic'].includes(credential.type)) throw new TypeError(`${prefix}.type must be bearer or basic`);
  if (!Number.isInteger(credential.rateLimitPerMinute) || credential.rateLimitPerMinute < 1 || credential.rateLimitPerMinute > 10000) {
    throw new TypeError(`${prefix}.rateLimitPerMinute must be an integer between 1 and 10000`);
  }
  if (credential.type === 'bearer' && !validHex(credential.tokenSha256, 32)) {
    throw new TypeError(`${prefix}.tokenSha256 must be a SHA-256 hex digest`);
  }
  if (credential.type === 'basic') {
    if (!credential.username || typeof credential.username !== 'string') throw new TypeError(`${prefix}.username is required`);
    if (!validHex(credential.passwordSalt, 16)) throw new TypeError(`${prefix}.passwordSalt must be 16-byte hex`);
    if (!validHex(credential.passwordScrypt, 64)) throw new TypeError(`${prefix}.passwordScrypt must be 64-byte hex`);
  }
  return Object.freeze({ ...credential, permissions: normalizePermissions(credential.permissions, prefix) });
}

export function validateAuthConfig(config) {
  if (!Array.isArray(config?.credentials) || config.credentials.length === 0) {
    throw new TypeError('auth config must contain a non-empty credentials array');
  }
  const ids = new Set();
  const basicUsers = new Set();
  const credentials = config.credentials.map((credential, index) => {
    const validated = validateCredential(credential, index);
    if (ids.has(validated.id)) throw new TypeError(`duplicate credential id: ${validated.id}`);
    ids.add(validated.id);
    if (validated.type === 'basic') {
      if (basicUsers.has(validated.username)) throw new TypeError(`duplicate basic username: ${validated.username}`);
      basicUsers.add(validated.username);
    }
    return validated;
  });
  return Object.freeze({ credentials: Object.freeze(credentials) });
}

export function loadAuthConfig(path) {
  if (!path) throw new TypeError('PV_AUTH_CONFIG_PATH is required');
  return validateAuthConfig(JSON.parse(readFileSync(path, 'utf8')));
}

function authenticateBearer(token, config) {
  const digest = createHash('sha256').update(token).digest('hex');
  for (const credential of config.credentials) {
    if (credential.type !== 'bearer') continue;
    if (safeHexEqual(digest, credential.tokenSha256)) return contextFor(credential);
  }
  throw authError('VF_AUTH_INVALID_BEARER');
}

function authenticateBasic(encoded, config) {
  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    throw authError('VF_AUTH_INVALID_BASIC');
  }
  const separator = decoded.indexOf(':');
  if (separator < 1) throw authError('VF_AUTH_INVALID_BASIC');
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  const credential = config.credentials.find((item) => item.type === 'basic' && item.username === username);
  if (!credential) {
    // Keep comparable work for unknown users without exposing whether a username exists.
    scryptSync(password, Buffer.alloc(16), 64);
    throw authError('VF_AUTH_INVALID_BASIC');
  }
  const derived = scryptSync(password, Buffer.from(credential.passwordSalt, 'hex'), 64).toString('hex');
  if (!safeHexEqual(derived, credential.passwordScrypt)) throw authError('VF_AUTH_INVALID_BASIC');
  return contextFor(credential);
}

export function createHttpAuthenticator(configInput) {
  const config = validateAuthConfig(configInput);
  return function authenticate(request) {
    const authorization = String(header(request?.headers, 'authorization') ?? '');
    const bearer = authorization.match(/^Bearer\s+(.+)$/i);
    if (bearer) return authenticateBearer(bearer[1], config);
    const basic = authorization.match(/^Basic\s+(.+)$/i);
    if (basic) return authenticateBasic(basic[1], config);
    throw authError('VF_AUTH_REQUIRED');
  };
}

export function hashBearerToken(token) {
  if (!token) throw new TypeError('token is required');
  return createHash('sha256').update(String(token)).digest('hex');
}

export function hashBasicPassword(password, saltHex) {
  if (!password) throw new TypeError('password is required');
  if (!validHex(saltHex, 16)) throw new TypeError('saltHex must be 16-byte hex');
  return scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64).toString('hex');
}
