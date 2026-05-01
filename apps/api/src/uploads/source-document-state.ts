import type { SourceDocumentStatus } from '@cherrygraph/shared';

export class SourceDocumentStateTransitionError extends Error {
  constructor(
    readonly from: SourceDocumentStatus,
    readonly to: SourceDocumentStatus,
  ) {
    super(`Illegal source document status transition from ${from} to ${to}`);
    this.name = 'SourceDocumentStateTransitionError';
  }
}

const LEGAL_TRANSITIONS = {
  uploaded: ['validating'],
  validating: ['archived', 'security_rejected'],
  archived: ['parsing'],
  parsing: ['parsed', 'parse_failed'],
  parsed: ['graphify_pending'],
  parse_failed: ['uploaded'],
  security_rejected: [],
  graphify_pending: ['graphify_running'],
  graphify_running: ['wiki_proposed', 'graphify_failed'],
  graphify_failed: ['graphify_pending'],
  wiki_proposed: ['published', 'sync_failed'],
  sync_failed: ['wiki_proposed'],
  published: ['indexed'],
  indexed: ['index_failed'],
  index_failed: ['indexed'],
} as const satisfies Record<SourceDocumentStatus, readonly SourceDocumentStatus[]>;

export class SourceDocumentStateMachine {
  static canTransition(from: SourceDocumentStatus, to: SourceDocumentStatus): boolean {
    const allowed: readonly SourceDocumentStatus[] = LEGAL_TRANSITIONS[from];
    return from === to || allowed.includes(to);
  }

  static assertTransition(from: SourceDocumentStatus, to: SourceDocumentStatus): void {
    if (!this.canTransition(from, to)) {
      throw new SourceDocumentStateTransitionError(from, to);
    }
  }
}
