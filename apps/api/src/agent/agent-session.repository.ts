import { Inject, Injectable } from '@nestjs/common';
import { agentSessions } from '@cherrygraph/shared';
import { and, eq, inArray, lt } from 'drizzle-orm';

import { DRIZZLE } from '../database/drizzle.constants.js';
import type { DrizzleDatabase } from '../database/drizzle.module.js';

export type AgentSessionRow = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;

@Injectable()
export class AgentSessionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDatabase) {}

  async upsert(data: NewAgentSession): Promise<AgentSessionRow> {
    const values = normalizeAgentSessionInsert(data);
    const [row] = await this.db
      .insert(agentSessions)
      .values(values)
      .onConflictDoUpdate({
        target: agentSessions.conversation_id,
        set: {
          tenant_id: values.tenant_id,
          space_id: values.space_id,
          user_id: values.user_id,
          provider: values.provider,
          provider_session_id: values.provider_session_id,
          work_dir: values.work_dir,
          agent_home: values.agent_home,
          status: values.status,
          options_hash: values.options_hash,
          owned_by_instance: values.owned_by_instance,
          last_activity_at: values.last_activity_at,
          process_started_at: values.process_started_at,
          process_stopped_at: values.process_stopped_at,
          updated_at: values.updated_at,
        },
      })
      .returning();

    if (row === undefined) {
      throw new Error(`Failed to upsert agent session ${data.conversation_id}`);
    }

    return row;
  }

  async findByConversationId(conversationId: string): Promise<AgentSessionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.conversation_id, conversationId))
      .limit(1);

    return row;
  }

  async updateProviderSessionId(conversationId: string, providerSessionId: string): Promise<void> {
    await this.db
      .update(agentSessions)
      .set({
        provider_session_id: providerSessionId,
        updated_at: new Date(),
      })
      .where(eq(agentSessions.conversation_id, conversationId));
  }

  async updateStatus(
    conversationId: string,
    status: string,
    extra: Partial<AgentSessionRow> = {},
  ): Promise<void> {
    const updates = { ...extra };
    delete updates.conversation_id;
    delete updates.created_at;
    delete updates.updated_at;

    await this.db
      .update(agentSessions)
      .set({
        ...updates,
        status,
        updated_at: new Date(),
      })
      .where(eq(agentSessions.conversation_id, conversationId));
  }

  async updateOwnedByInstance(conversationId: string, instanceId: string): Promise<void> {
    await this.db
      .update(agentSessions)
      .set({
        owned_by_instance: instanceId,
        updated_at: new Date(),
      })
      .where(eq(agentSessions.conversation_id, conversationId));
  }

  async touchActivity(conversationId: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(agentSessions)
      .set({
        last_activity_at: now,
        updated_at: now,
      })
      .where(eq(agentSessions.conversation_id, conversationId));
  }

  async delete(conversationId: string): Promise<void> {
    await this.db.delete(agentSessions).where(eq(agentSessions.conversation_id, conversationId));
  }

  async findStaleForRetentionCleanup(olderThan: Date, statuses: string[]): Promise<AgentSessionRow[]> {
    if (statuses.length === 0) {
      return [];
    }

    return this.db
      .select()
      .from(agentSessions)
      .where(and(lt(agentSessions.last_activity_at, olderThan), inArray(agentSessions.status, statuses)));
  }
}

function normalizeAgentSessionInsert(data: NewAgentSession): NewAgentSession {
  const now = new Date();

  return {
    conversation_id: data.conversation_id,
    tenant_id: data.tenant_id,
    space_id: data.space_id,
    user_id: data.user_id,
    provider: data.provider ?? 'claude',
    provider_session_id: data.provider_session_id ?? null,
    work_dir: data.work_dir,
    agent_home: data.agent_home,
    status: data.status,
    options_hash: data.options_hash ?? null,
    owned_by_instance: data.owned_by_instance ?? null,
    last_activity_at: data.last_activity_at,
    process_started_at: data.process_started_at ?? null,
    process_stopped_at: data.process_stopped_at ?? null,
    created_at: data.created_at ?? now,
    updated_at: data.updated_at ?? now,
  };
}
