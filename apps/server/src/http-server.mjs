import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const STATIC_FILES = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/src/model.mjs': ['src/model.mjs', 'text/javascript; charset=utf-8'],
});

function securityHeaders({ staticContent = false, api = false } = {}) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (api) headers['cache-control'] = 'no-store';
  if (staticContent) {
    headers['content-security-policy'] = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
    headers['cache-control'] = 'no-store';
  }
  return headers;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders(), ...headers });
  if (body == null) return res.end();
  res.end(body);
}

function sendJson(res, status, payload, headers = {}) {
  send(res, status, JSON.stringify(payload), {
    'content-type': 'application/json; charset=utf-8',
    ...securityHeaders({ api: true }),
    ...headers,
  });
}

function errorEnvelope(code, message, retryable = false) {
  return { error: { code, message, retryable, details: [] } };
}

function pathname(req) {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function readBody(req, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error(`Request body exceeds ${maxBodyBytes} bytes`), { code: 'VF_HTTP_BODY_TOO_LARGE', status: 413 }));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('aborted', () => reject(Object.assign(new Error('Request aborted'), { code: 'VF_HTTP_REQUEST_ABORTED', status: 400 })));
    req.on('error', reject);
  });
}

function authChallenge(path) {
  return path.startsWith('/v1/')
    ? 'Bearer realm="Puente VeriFactu"'
    : 'Basic realm="Puente VeriFactu", charset="UTF-8"';
}

async function serveStatic(res, onboardingDir, path, method) {
  const file = STATIC_FILES[path];
  if (!file) return false;
  const [relative, contentType] = file;
  const content = await readFile(join(onboardingDir, relative));
  const headers = {
    ...securityHeaders({ staticContent: true }),
    'content-type': contentType,
    'content-length': String(content.length),
  };
  if (method === 'HEAD') send(res, 200, null, headers);
  else send(res, 200, content, headers);
  return true;
}

function normalizedApiResponse(response, rate) {
  const headers = {
    ...(response?.headers ?? {}),
    'x-ratelimit-limit': String(rate.limit),
    'x-ratelimit-remaining': String(rate.remaining),
    'x-ratelimit-reset': String(Math.ceil(rate.resetAt / 1000)),
  };
  const payload = response?.body ?? {};
  return { status: response?.status ?? 500, headers, payload };
}

export function createPuenteHttpServer({
  apiHandler,
  authenticateHttp,
  rateLimiter,
  onboardingDir,
  readiness = async () => ({ ok: true }),
  maxBodyBytes = 6 * 1024 * 1024,
} = {}) {
  if (typeof apiHandler !== 'function') throw new TypeError('apiHandler is required');
  if (typeof authenticateHttp !== 'function') throw new TypeError('authenticateHttp is required');
  if (!rateLimiter || typeof rateLimiter.consume !== 'function') throw new TypeError('rateLimiter is required');
  if (!onboardingDir) throw new TypeError('onboardingDir is required');

  return createServer(async (req, res) => {
    const path = pathname(req);
    const method = String(req.method ?? 'GET').toUpperCase();

    try {
      if (path === '/healthz') return sendJson(res, 200, { status: 'ok' });
      if (path === '/readyz') {
        const state = await readiness();
        return sendJson(res, state?.ok ? 200 : 503, { status: state?.ok ? 'ready' : 'not_ready' });
      }

      let authContext;
      try {
        authContext = await authenticateHttp({ method, path, headers: req.headers });
      } catch (error) {
        const status = error?.status === 401 ? 401 : 500;
        const code = status === 401 ? (error.code ?? 'VF_AUTH_REQUIRED') : 'VF_AUTH_INTERNAL';
        return sendJson(res, status, errorEnvelope(code, status === 401 ? 'Unauthorized' : 'Authentication error'), {
          ...(status === 401 ? { 'www-authenticate': authChallenge(path) } : {}),
        });
      }

      const rate = rateLimiter.consume(authContext);
      if (!rate.allowed) {
        return sendJson(res, 429, errorEnvelope('VF_RATE_LIMITED', 'Too many requests', true), {
          'retry-after': String(rate.retryAfterSeconds),
          'x-ratelimit-limit': String(rate.limit),
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.ceil(rate.resetAt / 1000)),
        });
      }

      if ((method === 'GET' || method === 'HEAD') && await serveStatic(res, onboardingDir, path, method)) return;

      if (!path.startsWith('/v1/')) return sendJson(res, 404, errorEnvelope('VF_HTTP_ROUTE_NOT_FOUND', 'Route not found'));

      const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req, maxBodyBytes) : Buffer.alloc(0);
      const response = await apiHandler({
        method,
        path,
        headers: req.headers,
        body,
        rawBody: body,
        authContext,
      });
      const normalized = normalizedApiResponse(response, rate);
      sendJson(res, normalized.status, normalized.payload, normalized.headers);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      sendJson(res, status, errorEnvelope(
        error?.code ?? 'VF_HTTP_INTERNAL',
        status >= 500 ? 'Internal error' : error.message,
        status >= 500,
      ));
    }
  });
}
