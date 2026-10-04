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

  size() {
    return this.batches.size;
  }
}
