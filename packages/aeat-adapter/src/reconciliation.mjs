import { periodFromDate } from './query.mjs';

function reconciliationError(code, message, field = null) {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  return error;
}

function sourceReference(entry) {
  if (entry?.record?.recordType === 'anulacion') return entry.record?.source?.sourceCancellationId ?? null;
  return entry?.record?.source?.sourceInvoiceId ?? entry?.intent?.sourceInvoiceId ?? null;
}

function expectedEntry(entry, issuer) {
  const record = entry?.record;
  if (!record?.invoice) throw reconciliationError('VF_AEAT_RECONCILIATION_RECORD_REQUIRED', 'Fiscal record identity is required');
  const refExternal = sourceReference(entry);
  if (!refExternal) throw reconciliationError('VF_AEAT_RECONCILIATION_REFERENCE_REQUIRED', 'RefExterna source identity is required');
  const dateForPeriod = entry?.intent?.operationDate ?? entry?.intent?.issueDate ?? record.invoice.issueDate;
  return {
    issuerTaxId: issuer?.taxId ?? record.invoice.issuerTaxId,
    fiscalNumber: record.invoice.fiscalNumber,
    issueDate: record.invoice.issueDate,
    refExternal,
    hash: record.hash,
    recordType: record.recordType,
    period: periodFromDate(dateForPeriod),
  };
}

function exactMatches(queryResult, expected) {
  return (queryResult?.records ?? []).filter((record) => (
    record.issuerTaxId === expected.issuerTaxId
    && record.fiscalNumber === expected.fiscalNumber
    && record.issueDate === expected.issueDate
    && record.refExternal === expected.refExternal
    && record.hash === expected.hash
  ));
}

export function assessAeatQueryReconciliation(queryResult, expected) {
  if (!queryResult || ['transport_error', 'http_error', 'soap_fault'].includes(queryResult.kind) || queryResult.status === 'fault') {
    return {
      outcome: 'query_error',
      received: false,
      retrySafe: false,
      shouldReissue: false,
      reason: queryResult?.errorCode ?? queryResult?.kind ?? 'query_error',
    };
  }
  if (queryResult.pagination) {
    return {
      outcome: 'ambiguous',
      received: false,
      retrySafe: false,
      shouldReissue: false,
      reason: 'paginated_result_requires_review',
    };
  }
  if (queryResult.status === 'not_found') {
    return {
      outcome: 'not_found',
      received: false,
      retrySafe: false,
      shouldReissue: false,
      reason: 'not_found_is_not_proof_of_safe_reissue',
    };
  }
  if (queryResult.status !== 'found') {
    return {
      outcome: 'ambiguous',
      received: false,
      retrySafe: false,
      shouldReissue: false,
      reason: 'unexpected_query_status',
    };
  }

  const matches = exactMatches(queryResult, expected);
  if (matches.length === 0) {
    return {
      outcome: 'mismatch',
      received: false,
      retrySafe: false,
      shouldReissue: false,
      reason: 'query_data_does_not_match_fiscal_identity',
    };
  }
  if (matches.length !== 1 || queryResult.records.length !== 1) {
    return {
      outcome: 'ambiguous',
      received: false,
      retrySafe: false,
      shouldReissue: false,
      reason: 'multiple_query_records',
    };
  }

  const match = matches[0];
  if (!['accepted', 'accepted_with_errors', 'cancelled'].includes(match.storedState)) {
    return {
      outcome: 'ambiguous',
      received: false,
      retrySafe: false,
      shouldReissue: false,
      reason: 'unknown_stored_state',
    };
  }
  return {
    outcome: 'received',
    received: true,
    retrySafe: false,
    shouldReissue: false,
    storedState: match.storedState,
    requestId: match.requestId ?? null,
    presentedAt: match.presentedAt ?? null,
    lastModifiedAt: match.lastModifiedAt ?? null,
    errorCode: match.errorCode ?? null,
  };
}

export class AeatOfficialReconciler {
  constructor({ adapter, outbox, clock = () => Date.now() }) {
    if (!adapter || typeof adapter.queryPresentedRecords !== 'function') {
      throw new TypeError('adapter with queryPresentedRecords() is required');
    }
    if (!outbox || typeof outbox.resolveReconciliation !== 'function') {
      throw new TypeError('outbox with resolveReconciliation() is required');
    }
    this.adapter = adapter;
    this.outbox = outbox;
    this.clock = clock;
  }

  async inspect(jobId, { apply = true } = {}) {
    const job = this.outbox.get(jobId);
    if (!job) throw reconciliationError('VF_AEAT_OUTBOX_JOB_NOT_FOUND', 'Outbox job not found');
    if (job.state !== 'reconciliation_required') {
      throw reconciliationError('VF_AEAT_OUTBOX_NOT_RECONCILABLE', 'Outbox job is not awaiting reconciliation');
    }
    const entries = job.payload?.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
      throw reconciliationError('VF_AEAT_RECONCILIATION_ENTRIES_REQUIRED', 'Reconciliation needs at least one fiscal entry');
    }

    const results = [];
    for (const entry of entries) {
      const expected = expectedEntry(entry, job.payload.issuer);
      const query = await this.adapter.queryPresentedRecords({
        issuer: job.payload.issuer,
        period: expected.period,
        refExternal: expected.refExternal,
      });
      results.push({
        refExternal: expected.refExternal,
        fiscalNumber: expected.fiscalNumber,
        issueDate: expected.issueDate,
        assessment: assessAeatQueryReconciliation(query, expected),
      });
    }

    const allReceived = results.every((item) => item.assessment.received === true);
    const assessment = {
      kind: 'aeat_official_reconciliation',
      outcome: allReceived ? 'received' : 'unresolved',
      allReceived,
      shouldReissue: false,
      inspectedAt: this.clock(),
      applied: false,
      entries: results,
    };

    if (!allReceived || !apply) return { job: this.outbox.get(jobId), assessment };

    const appliedAssessment = { ...assessment, applied: true };
    const resolved = this.outbox.resolveReconciliation(jobId, {
      action: 'complete',
      result: appliedAssessment,
      now: this.clock(),
    });
    return { job: resolved, assessment: appliedAssessment };
  }
}
