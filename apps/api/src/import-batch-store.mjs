function clone(value) {
  return value == null ? value : structuredClone(value);
}

function error(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

export class MemoryImportBatchStore {
  constructor() {
    this.batches = new Map();
  }

  key(organizationId, installationId, batchId) {
    return [organizationId, installationId, batchId].join('\u001f');
  }

  create(batch) {
    const key = this.key(batch.organizationId, batch.installationId, batch.batchId);
    const existing = this.batches.get(key);
    if (existing) return clone(existing);
    this.batches.set(key, clone(batch));
    return clone(batch);
  }

  get(organizationId, installationId, batchId) {
    return clone(this.batches.get(this.key(organizationId, installationId, batchId)) ?? null);
  }

  list(organizationId, installationId, limit = 50) {
    return [...this.batches.values()]
      .filter((batch) => batch.organizationId === organizationId && batch.installationId === installationId)
      .sort((a, b) => b.createdAt - a.createdAt || a.batchId.localeCompare(b.batchId))
      .slice(0, limit)
      .map(clone);
  }

  claim({ organizationId, installationId, batchId, owner, now, leaseUntil }) {
    const key = this.key(organizationId, installationId, batchId);
    const batch = this.batches.get(key);
    if (!batch) return null;
    if (batch.state === 'completed') return clone(batch);
    if (
      batch.state === 'processing'
      && batch.lease?.until > now
      && batch.lease?.owner !== owner
    ) {
      throw error('VF_IMPORT_BATCH_BUSY', 'Import batch is already being processed', 409);
    }
    batch.state = 'processing';
    batch.lease = { owner, until: leaseUntil };
    batch.updatedAt = now;
    return clone(batch);
  }

  updateRow({
    organizationId,
    installationId,
    batchId,
    row,
    patch,
    owner,
    now,
  }) {
    const key = this.key(organizationId, installationId, batchId);
    const batch = this.batches.get(key);
    if (!batch) throw error('VF_IMPORT_BATCH_NOT_FOUND', 'Import batch not found', 404);
    if (batch.lease?.owner !== owner) {
      throw error('VF_IMPORT_BATCH_LEASE_LOST', 'Import batch lease is not owned by this worker', 409);
    }
    const target = batch.rows.find((item) => item.row === row);
    if (!target) throw error('VF_IMPORT_BATCH_ROW_NOT_FOUND', 'Import batch row not found', 404);
    Object.assign(target, clone(patch));
    batch.updatedAt = now;
    return clone(target);
  }

  finalize({
    organizationId,
    installationId,
    batchId,
    owner,
    state,
    summary,
    now,
  }) {
    const key = this.key(organizationId, installationId, batchId);
    const batch = this.batches.get(key);
    if (!batch) throw error('VF_IMPORT_BATCH_NOT_FOUND', 'Import batch not found', 404);
    if (batch.lease?.owner !== owner) {
      throw error('VF_IMPORT_BATCH_LEASE_LOST', 'Import batch lease is not owned by this worker', 409);
    }
    batch.state = state;
    batch.summary = clone(summary);
    batch.lease = null;
    batch.updatedAt = now;
    return clone(batch);
  }
}
