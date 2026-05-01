import { describe, expect, it } from 'vitest';

import { PublishStateMachine } from '../state-machine.js';

describe('PublishStateMachine', () => {
  const machine = new PublishStateMachine();

  it('publishes drafts', () => {
    expect(machine.canPublish('draft')).toBe(true);
    expect(machine.publish('draft')).toBe('published');
  });

  it('rejects publishing already published versions', () => {
    expect(() => machine.publish('published')).toThrow('VERSION_ALREADY_PUBLISHED');
  });

  it('rejects publishing archived versions', () => {
    expect(() => machine.publish('archived')).toThrow();
  });

  it('archives published pages', () => {
    expect(machine.canArchive('published')).toBe(true);
    expect(machine.archive('published')).toBe('archived');
  });

  it('rejects archiving drafts', () => {
    expect(() => machine.archive('draft')).toThrow();
  });

  it('creates rollback version data', () => {
    expect(machine.rollback('# Prior content', 3)).toEqual({
      content: '# Prior content',
      versionNo: 4,
      source: 'rollback',
      status: 'published',
    });
  });
});
