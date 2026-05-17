import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';

describe('Chat session delete cascade schema', () => {
  it('cascades retrieval traces when a chat session is deleted', () => {
    expect(foreignKeyOnDelete(schema.retrievalTraces, 'retrieval_traces_conversation_id_chat_sessions_id_fk')).toBe(
      'cascade',
    );
  });

  it('cascades model usage logs when a chat session is deleted', () => {
    expect(foreignKeyOnDelete(schema.modelUsageLogs, 'model_usage_logs_conversation_id_chat_sessions_id_fk')).toBe(
      'cascade',
    );
  });

  it('cascades feedback items when a chat message is deleted', () => {
    expect(foreignKeyOnDelete(schema.feedbackItems, 'feedback_items_message_id_chat_messages_id_fk')).toBe('cascade');
  });
});

function foreignKeyOnDelete(table: PgTable, foreignKeyName: string): string | undefined {
  const tableConfig = getTableConfig(table);
  const foreignKey = tableConfig.foreignKeys.find((candidate) => candidate.getName() === foreignKeyName);

  expect(foreignKey).toBeDefined();

  return foreignKey?.onDelete;
}
