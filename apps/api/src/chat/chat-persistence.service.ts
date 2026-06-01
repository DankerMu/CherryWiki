import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_EVENTS } from '../audit/audit-events.js';
import { AuditService } from '../audit/audit.service.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import {
  answerCitations,
  chatMessages,
  chatSessions,
  modelUsageLogs,
  retrievalTraces,
} from '@cherrygraph/shared';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';

import type { RetrievedContext } from './chat-retrieval.service.js';
import type { ChatAuditContext } from './chat.service.js';
import type { ChatUsage, CitationResponse } from './chat-events.js';

type ChatDatabase = NodePgDatabase;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type ChatMessageRole = 'user' | 'assistant' | 'system';

export type ChatPersistenceCompletionContext = {
  tenantId: string;
  userId: string;
  space: { id: string };
  spaceIds: string[];
  session: { id: string };
  message: string;
  chatModel: { id: string };
  auditContext: ChatAuditContext;
};

@Injectable()
export class ChatPersistenceService {
  constructor(
    @Inject(DRIZZLE) private readonly db: ChatDatabase,
    private readonly auditService: AuditService,
  ) {}

  async persistMessage(
    sessionId: string,
    role: ChatMessageRole,
    content: string,
    tokenCount?: number,
    citationsJson: unknown[] = [],
    metadataJson: Record<string, unknown> = {},
  ): Promise<ChatMessageRow> {
    const now = new Date();
    const [created] = await this.db
      .insert(chatMessages)
      .values({
        id: randomUUID(),
        session_id: sessionId,
        role,
        content,
        token_count: tokenCount ?? null,
        citations_json: citationsJson,
        metadata_json: metadataJson,
        created_at: now,
      })
      .returning();

    if (created === undefined) {
      throw new Error('Failed to persist chat message');
    }

    await this.db.update(chatSessions).set({ updated_at: now }).where(eq(chatSessions.id, sessionId));

    return created;
  }

  async persistCitations(messageId: string, citations: CitationResponse[]): Promise<void> {
    if (citations.length === 0) {
      return;
    }

    await this.db.insert(answerCitations).values(
      citations.map((citation) => ({
        id: randomUUID(),
        message_id: messageId,
        wiki_page_pk: citation.wiki_page_pk,
        ...(citation.space_id !== undefined ? { space_id: citation.space_id } : {}),
        section_id: citation.section_id,
        chunk_id: citation.chunk_id,
        relevance_score: citation.relevance_score,
        source_chain_json: citation.source_chain_json,
        display_text: citation.display_text,
      })),
    );
  }

  async persistRetrievalTrace(
    context: ChatPersistenceCompletionContext,
    retrievalMode: string,
    retrievedContext: RetrievedContext,
  ): Promise<void> {
    await this.db.insert(retrievalTraces).values({
      id: randomUUID(),
      tenant_id: context.tenantId,
      user_id: context.userId,
      conversation_id: context.session.id,
      space_ids: context.spaceIds,
      query: context.message,
      retrieval_mode: normalizeRetrievalMode(retrievalMode),
      candidates_json: retrievedContext.trace.candidates,
      acl_filtered_json: retrievedContext.trace.aclFiltered,
      final_context_json: retrievedContext.trace.finalContext,
    });
  }

  async recordStaticModelUsage(
    context: ChatPersistenceCompletionContext,
    usage: ChatUsage,
    latencyMs: number,
  ): Promise<void> {
    await this.db.insert(modelUsageLogs).values({
      id: randomUUID(),
      tenant_id: context.tenantId,
      user_id: context.userId,
      model_config_id: context.chatModel.id,
      request_type: 'static_rag',
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      latency_ms: Math.max(0, Math.trunc(latencyMs)),
      space_id: context.space.id,
      conversation_id: context.session.id,
    });
  }

  pushCompletionAudit(
    context: ChatPersistenceCompletionContext,
    usage: ChatUsage,
    retrievalCount: number,
    hasCitations: boolean,
    assistantMessageId?: string,
    metadata: Record<string, unknown> = {},
  ): void {
    this.auditService.push({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      action: AUDIT_EVENTS.CHAT_COMPLETION,
      resource_type: 'chat_session',
      resource_id: context.session.id,
      space_id: context.space.id,
      ...(context.auditContext.ip !== undefined ? { ip: context.auditContext.ip } : {}),
      ...(context.auditContext.userAgent !== undefined ? { user_agent: context.auditContext.userAgent } : {}),
      ...(context.auditContext.requestId !== undefined ? { request_id: context.auditContext.requestId } : {}),
      metadata_json: {
        user_id: context.userId,
        space_id: context.space.id,
        space_ids: context.spaceIds,
        session_id: context.session.id,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        retrieval_count: retrievalCount,
        has_citations: hasCitations,
        ...(assistantMessageId !== undefined ? { assistant_message_id: assistantMessageId } : {}),
        ...metadata,
      },
    });
  }
}

function normalizeRetrievalMode(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized === undefined || normalized.length === 0 ? 'wiki_only' : normalized;
}
