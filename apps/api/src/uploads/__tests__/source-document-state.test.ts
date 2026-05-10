import { describe, expect, it } from 'vitest';

import { SourceDocumentStateMachine, SourceDocumentStateTransitionError } from '../source-document-state.js';

describe('SourceDocumentStateMachine', () => {
  it.each([
    ['uploaded', 'validating'],
    ['validating', 'archived'],
    ['validating', 'security_rejected'],
    ['archived', 'parsing'],
    ['parsing', 'parsed'],
    ['parsing', 'parse_failed'],
    ['parsed', 'graphify_pending'],
    ['parse_failed', 'uploaded'],
    ['security_rejected', 'uploaded'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(SourceDocumentStateMachine.canTransition(from, to)).toBe(true);
    expect(() => SourceDocumentStateMachine.assertTransition(from, to)).not.toThrow();
  });

  it.each([
    ['uploaded', 'parsing'],
    ['parsed', 'uploaded'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(SourceDocumentStateMachine.canTransition(from, to)).toBe(false);
    expect(() => SourceDocumentStateMachine.assertTransition(from, to)).toThrow(
      SourceDocumentStateTransitionError,
    );
  });
});
