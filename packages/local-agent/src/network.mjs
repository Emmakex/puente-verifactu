export function assertOutboundBaseUrl(value, { allowInsecureLocalhost = false } = {}) {
  const url = new URL(value);
  const localhost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowInsecureLocalhost && localhost && url.protocol === 'http:')) {
    throw Object.assign(new Error('Local Agent requires outbound HTTPS'), {
      code: 'VF_LOCAL_AGENT_HTTPS_REQUIRED',
    });
  }
  if (url.username || url.password) {
    throw Object.assign(new Error('Credentials must not be embedded in the Local Agent base URL'), {
      code: 'VF_LOCAL_AGENT_URL_CREDENTIALS_FORBIDDEN',
    });
  }
  return url.toString().replace(/\/$/, '');
}
