const TERMINAL = new Set(['accepted', 'accepted_with_errors']);

const TRANSITIONS = Object.freeze({
  received: new Set(['validation_failed', 'validated']),
  validation_failed: new Set(['received', 'blocked']),
  validated: new Set(['fiscalized', 'blocked']),
  fiscalized: new Set(['queued', 'blocked']),
  queued: new Set(['sending', 'blocked']),
  sending: new Set(['accepted', 'accepted_with_errors', 'rejected', 'retry_scheduled', 'blocked']),
  rejected: new Set(['blocked']),
  retry_scheduled: new Set(['sending', 'blocked']),
  blocked: new Set(['received', 'validated', 'queued']),
  accepted: new Set(),
  accepted_with_errors: new Set(),
});

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.has(to));
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition: ${from} -> ${to}`);
  }
  return to;
}

export function isTerminalState(state) {
  return TERMINAL.has(state);
}
