export class MemoryImportSessionStore {
  constructor() {
    this.sessions = new Map();
  }

  purgeExpired(now) {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }

  ensureCapacity(maxSessions, now) {
    this.purgeExpired(now);
    while (this.sessions.size >= maxSessions) this.sessions.delete(this.sessions.keys().next().value);
  }

  put(session) {
    this.sessions.set(session.importId, structuredClone(session));
    return session;
  }

  get(importId) {
    const session = this.sessions.get(importId);
    return session ? structuredClone(session) : null;
  }

  delete(importId) {
    return this.sessions.delete(importId);
  }

  size() {
    return this.sessions.size;
  }
}

export class MemoryImportBatchStore {
  constructor() {
    this.batches = new Map();
  }

  create(batch) {
    const existing = this.batches.get(batch.batchId);
    if (existing) {
      if (existing.fingerprint !== batch.fingerprint) {
        throw Object.assign(new Error('Import batch already exists with different content'), {
          code: 'VF_IMPORT_BATCH_CONFLICT',
          status: 409,
        });
      }
      return structuredClone(existing);
    }
    this.batches.set(batch.batchId, structuredClone(batch));
    return structuredClone(batch);
  }

  get(batchId, context = null) {
    const batch = this.batches.get(batchId);
    if (!batch) return null;
    if (
      context
      && (
        batch.organizationId !== context.organizationId
        || batch.installationId !== context.installationId
      )
    ) {
      return null;
    }
    return structuredClone(batch);
  }

  acquireLease({
    batchId,
    organizationId,
    installationId,
    leaseToken,
    now,
    expiresAt,
  }) {
    const batch = this.batches.get(batchId);
    if (
      !batch
      || batch.organizationId !== organizationId
      || batch.installationId !== installationId
      || batch.status === 'completed'
    ) {
      return null;
    }
    if (batch.lease && batch.lease.expiresAt > now) return null;
    batch.lease = { token: leaseToken, expiresAt };
    batch.status = 'processing';
    batch.updatedAt = now;
    this.batches.set(batchId, batch);
    return structuredClone(batch);
  }

  updateRow({
    batchId,
    organizationId,
    installationId,
    leaseToken,
    row,
    patch,
    now,
  }) {
    const batch = this.batches.get(batchId);
    if (
      !batch
      || batch.organizationId !== organizationId
      || batch.installationId !== installationId
      || batch.lease?.token !== leaseToken
    ) {
      throw Object.assign(new Error('Import batch lease is not owned by this worker'), {
        code: 'VF_IMPORT_BATCH_LEASE_LOST',
        status: 409,
      });
    }
    const target = batch.rows.find((item) => item.row === row);
    if (!target) {
      throw Object.assign(new Error('Import batch row not found'), {
        code: 'VF_IMPORT_BATCH_ROW_NOT_FOUND',
        status: 404,
      });
    }
    Object.assign(target, structuredClone(patch), { updatedAt: now });
    batch.updatedAt = now;
    this.batches.set(batchId, batch);
    return structuredClone(batch);
  }

  releaseLease({
    batchId,
    organizationId,
    installationId,
    leaseToken,
    status,
    now,
  }) {
    const batch = this.batches.get(batchId);
    if (
      !batch
      || batch.organizationId !== organizationId
      || batch.installationId !== installationId
      || batch.lease?.token !== leaseToken
    ) {
      throw Object.assign(new Error('Import batch lease is not owned by this worker'), {
        code: 'VF_IMPORT_BATCH_LEASE_LOST',
        status: 409,
      });
    }
    batch.lease = null;
    batch.status = status;
    batch.updatedAt = now;
    this.batches.set(batchId, batch);
    return structuredClone(batch);
  }

  size() {
    return this.batches.size;
  }
}
