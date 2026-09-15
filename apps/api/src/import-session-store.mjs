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
