import { createHash, randomBytes } from 'node:crypto';

const TEXT_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const VERSION_RE = /^[0-9A-Za-z._+-]{1,64}$/;
const SOURCE_KINDS = new Set(['watch-folder', 'database', 'sftp']);
const UPDATE_POLICIES = new Set(['manual', 'disabled']);
const REPORTED_STATUS = new Set(['ok', 'degraded', 'error']);

function apiError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function requiredId(value, name) {
  const text = String(value ?? '').trim();
  if (!TEXT_RE.test(text)) throw apiError('VF_LOCAL_AGENT_CONTROL_INPUT_INVALID', `${name} is invalid`);
  return text;
}

function optionalLabel(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!text || text.length > 160) throw apiError('VF_LOCAL_AGENT_CONTROL_INPUT_INVALID', 'label is invalid');
  return text;
}

function optionalVersion(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!VERSION_RE.test(text)) throw apiError('VF_LOCAL_AGENT_CONTROL_INPUT_INVALID', 'version is invalid');
  return text;
}

function tokenDigest(token) {
  return createHash('sha256').update(token).digest('hex');
}

function newToken() {
  return `pvla_${randomBytes(32).toString('base64url')}`;
}

function queueSummary(value = {}) {
  const result = {};
  for (const key of ['total', 'pending', 'processing', 'completed', 'blocked', 'due', 'expired']) {
    const count = Number(value?.[key] ?? 0);
    if (!Number.isInteger(count) || count < 0 || count > 1_000_000_000) {
      throw apiError('VF_LOCAL_AGENT_HEARTBEAT_INVALID', `queue.${key} is invalid`);
    }
    result[key] = count;
  }
  return Object.freeze(result);
}

function publicState(record, now, offlineAfterMs) {
  if (!record) return null;
  const online = record.lastSeenAt != null
    && record.revoked !== true
    && now - record.lastSeenAt <= offlineAfterMs;
  return Object.freeze({
    ...record,
    online,
    status: record.revoked ? 'revoked' : (online ? (record.reportedStatus ?? 'ok') : 'offline'),
    updateAvailable: Boolean(
      record.desiredVersion
      && record.agentVersion
      && record.desiredVersion !== record.agentVersion
      && record.updatePolicy !== 'disabled'
    ),
  });
}

export class KairosethLocalAgentControlPlane {
  constructor({
    store,
    clock = () => Date.now(),
    offlineAfterMs = 180_000,
    agentRateLimitPerMinute = 240,
  } = {}) {
    if (!store) throw new TypeError('store is required');
    for (const method of [
      'authByTokenSha256',
      'create',
      'get',
      'list',
      'rotateCredential',
      'revoke',
      'setControl',
      'heartbeat',
    ]) {
      if (typeof store[method] !== 'function') {
        throw new TypeError(`store.${method} must be a function`);
      }
    }
    if (typeof clock !== 'function') throw new TypeError('clock is required');
    if (!Number.isInteger(offlineAfterMs) || offlineAfterMs < 30_000) throw new TypeError('offlineAfterMs is invalid');
    this.store = store;
    this.clock = clock;
    this.offlineAfterMs = offlineAfterMs;
    this.agentRateLimitPerMinute = agentRateLimitPerMinute;
  }

  async authenticateBearerDigest(digest) {
    const record = await this.store.authByTokenSha256(String(digest ?? ''));
    if (!record) return null;
    return Object.freeze({
      credentialId: `local-agent:${record.organizationId}:${record.installationId}:v${record.credentialVersion}`,
      organizationId: record.organizationId,
      installationId: record.installationId,
      sourceSystem: record.sourceSystem,
      authType: 'local-agent-bearer',
      credentialKind: 'local-agent',
      rateLimitPerMinute: this.agentRateLimitPerMinute,
      permissions: Object.freeze([]),
    });
  }

  async get(organizationId, installationId) {
    const record = await this.store.get(
      requiredId(organizationId, 'organizationId'),
      requiredId(installationId, 'installationId'),
    );
    if (!record) return null;
    return publicState(record, this.clock(), this.offlineAfterMs);
  }

  async provision(input = {}) {
    const organizationId = requiredId(input.organizationId, 'organizationId');
    const installationId = requiredId(input.installationId, 'installationId');
    const sourceSystem = requiredId(input.sourceSystem ?? 'local-agent', 'sourceSystem');
    const updatePolicy = String(input.updatePolicy ?? 'manual');
    if (!UPDATE_POLICIES.has(updatePolicy)) throw apiError('VF_LOCAL_AGENT_CONTROL_INPUT_INVALID', 'updatePolicy is invalid');

    const token = newToken();
    const record = await this.store.create({
      organizationId,
      installationId,
      sourceSystem,
      label: optionalLabel(input.label),
      tokenSha256: tokenDigest(token),
      desiredVersion: optionalVersion(input.desiredVersion),
      updatePolicy,
      now: this.clock(),
    });

    return Object.freeze({
      installation: publicState(record, this.clock(), this.offlineAfterMs),
      credential: Object.freeze({
        type: 'bearer',
        token,
        shownOnce: true,
      }),
    });
  }

  async rotateCredential(input = {}) {
    const organizationId = requiredId(input.organizationId, 'organizationId');
    const installationId = requiredId(input.installationId, 'installationId');
    const token = newToken();
    const record = await this.store.rotateCredential({
      organizationId,
      installationId,
      tokenSha256: tokenDigest(token),
      now: this.clock(),
    });
    return Object.freeze({
      installation: publicState(record, this.clock(), this.offlineAfterMs),
      credential: Object.freeze({ type: 'bearer', token, shownOnce: true }),
    });
  }

  async revoke(input = {}) {
    const record = await this.store.revoke({
      organizationId: requiredId(input.organizationId, 'organizationId'),
      installationId: requiredId(input.installationId, 'installationId'),
      now: this.clock(),
    });
    return publicState(record, this.clock(), this.offlineAfterMs);
  }

  async setControl(input = {}) {
    const organizationId = requiredId(input.organizationId, 'organizationId');
    const installationId = requiredId(input.installationId, 'installationId');
    const updatePolicy = String(input.updatePolicy ?? 'manual');
    if (!UPDATE_POLICIES.has(updatePolicy)) throw apiError('VF_LOCAL_AGENT_CONTROL_INPUT_INVALID', 'updatePolicy is invalid');
    const current = await this.store.get(organizationId, installationId);
    if (!current) throw apiError('VF_LOCAL_AGENT_INSTALLATION_NOT_FOUND', 'Local Agent installation not found', 404);
    const record = await this.store.setControl({
      organizationId,
      installationId,
      desiredVersion: optionalVersion(input.desiredVersion),
      updatePolicy,
      label: input.label === undefined ? current.label : optionalLabel(input.label),
      now: this.clock(),
    });
    return publicState(record, this.clock(), this.offlineAfterMs);
  }

  async list() {
    const now = this.clock();
    const records = await this.store.list();
    return Object.freeze(records.map((record) => publicState(record, now, this.offlineAfterMs)));
  }

  async heartbeat(context, input = {}) {
    if (context?.credentialKind !== 'local-agent') {
      throw apiError('VF_LOCAL_AGENT_HEARTBEAT_FORBIDDEN', 'Local Agent credential required', 403);
    }
    if ('organizationId' in input || 'installationId' in input || 'sourceSystem' in input) {
      throw apiError('VF_LOCAL_AGENT_HEARTBEAT_IDENTITY_FORBIDDEN', 'Heartbeat identity is server-authoritative');
    }

    const agentVersion = optionalVersion(input.agentVersion);
    if (!agentVersion) throw apiError('VF_LOCAL_AGENT_HEARTBEAT_INVALID', 'agentVersion is required');
    const platform = requiredId(input.platform, 'platform');
    const arch = requiredId(input.arch, 'arch');
    const sourceKind = String(input.sourceKind ?? '');
    if (!SOURCE_KINDS.has(sourceKind)) throw apiError('VF_LOCAL_AGENT_HEARTBEAT_INVALID', 'sourceKind is invalid');
    const reportedStatus = String(input.status ?? 'ok');
    if (!REPORTED_STATUS.has(reportedStatus)) throw apiError('VF_LOCAL_AGENT_HEARTBEAT_INVALID', 'status is invalid');

    const now = this.clock();
    const record = await this.store.heartbeat({
      organizationId: context.organizationId,
      installationId: context.installationId,
      agentVersion,
      platform,
      arch,
      sourceKind,
      reportedStatus,
      queue: queueSummary(input.queue),
      now,
    });
    const state = publicState(record, now, this.offlineAfterMs);
    return Object.freeze({
      schemaVersion: 1,
      accepted: true,
      serverTime: new Date(now).toISOString(),
      installation: state,
      control: Object.freeze({
        desiredVersion: state.desiredVersion,
        updatePolicy: state.updatePolicy,
        updateAvailable: state.updateAvailable,
        autoUpdate: false,
      }),
    });
  }
}
