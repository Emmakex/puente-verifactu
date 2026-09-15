export const INVOICE_INTENT_VERSION = 1;
export const MAPPING_PROFILE_VERSION = 1;

// AEAT VERI*FACTU invoice types verified against the official FAQ current at 2026-09-15.
export const INVOICE_TYPES = Object.freeze([
  'F1',
  'F2',
  'F3',
  'R1',
  'R2',
  'R3',
  'R4',
  'R5',
]);

export const RECTIFICATION_TYPES = Object.freeze(['S', 'I']);

export const ADJUSTMENT_TYPES = Object.freeze([
  'withholding',
  'surcharge',
  'discount',
  'other',
]);

export const INTAKE_STATES = Object.freeze([
  'received',
  'validation_failed',
  'validated',
  'fiscalized',
  'queued',
  'sending',
  'accepted',
  'accepted_with_errors',
  'rejected',
  'retry_scheduled',
  'blocked',
]);
