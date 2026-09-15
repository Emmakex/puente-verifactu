export class ReferenceConnector {
  constructor({ client, profileId, sourceName = 'reference-connector' } = {}) {
    if (!client) throw new TypeError('client is required');
    if (!profileId) throw new TypeError('profileId is required');
    this.client = client;
    this.profileId = profileId;
    this.sourceName = sourceName;
  }

  preflight(source) {
    return this.client.preflightMapped(this.profileId, source);
  }

  send(source, { eventId } = {}) {
    if (!eventId) throw new TypeError('eventId is required for idempotency');
    return this.client.issueMapped(this.profileId, source, { idempotencyKey: `${this.sourceName}:${eventId}` });
  }

  status(recordId) {
    return this.client.getFiscalRecord(recordId);
  }
}
