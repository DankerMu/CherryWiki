import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';

describe('Chat schema validation', () => {
  it('accepts supported chat message roles', () => {
    for (const role of ['user', 'assistant', 'system']) {
      expect(schema.chatMessageRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it('rejects unsupported chat message roles', () => {
    for (const role of ['tool', '', 'unknown']) {
      expect(schema.chatMessageRoleSchema.safeParse(role).success).toBe(false);
    }
  });

  it('validates chat session insert inputs', () => {
    const validSession = {
      id: 'chat-session-1',
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      user_id: 'user-1',
      title: null,
    };

    expect(schema.chatSessionSchema.safeParse(validSession).success).toBe(true);
  });

  it('validates chat message insert inputs with citations JSON', () => {
    const validMessage = {
      id: 'chat-message-1',
      session_id: 'chat-session-1',
      role: 'assistant',
      content: 'The answer cites one source.',
      token_count: 7,
      citations_json: [{ page_id: 'wiki-page-1', display_text: 'Source 1' }],
      metadata_json: { finish_reason: 'stop' },
    };

    expect(schema.chatMessageSchema.safeParse(validMessage).success).toBe(true);
  });

  it('validates answer citation insert inputs', () => {
    const validCitation = {
      id: 'answer-citation-1',
      message_id: 'chat-message-1',
      wiki_page_pk: 'wiki-page-pk-1',
      section_id: 'wiki-section-1',
      chunk_id: 'wiki-chunk-1',
      relevance_score: 0.91,
      source_chain_json: { page_id: 'wiki-page-1', chunk_index: 0 },
      display_text: 'Wiki page > Section',
    };

    expect(schema.answerCitationSchema.safeParse(validCitation).success).toBe(true);
  });
});
