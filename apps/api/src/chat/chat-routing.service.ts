import { Inject, Injectable, Optional } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  AgentService,
  isDatabaseToggleVisible,
  normalizeDatabaseConfig,
} from '../agent/agent.service.js';
import type { AgentSpawnOptions } from '../agent/dto/agent.dto.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { decryptSpaceDatabaseConfig } from '../spaces/database-config.js';
import type { SpaceRow } from './chat-session-boundary.service.js';

type ChatDatabase = NodePgDatabase;

export type Intent =
  | 'relationship_explanation'
  | 'architecture_reasoning'
  | 'fact_lookup'
  | 'how_to'
  | 'summarization';

export type QueryRoute = {
  path: 'agent' | 'static_rag';
  reason: string;
  intent: Intent;
};

export type ChatRoutingInput = {
  query: string;
  sessionId: string;
  space: SpaceRow;
  enableDeepAnalysis?: boolean;
  enableDatabase?: boolean;
  retrievalMode?: string;
};

export type DatabaseMode = 'enabled' | 'disabled' | 'unavailable_multi_space';

export type AgentDispatchContext = {
  databaseMode: DatabaseMode;
  agentOptions: AgentSpawnOptions;
};

@Injectable()
export class ChatRoutingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: ChatDatabase,
    @Optional() private readonly agentService?: AgentService,
  ) {}

  async decideRoute(input: ChatRoutingInput): Promise<QueryRoute> {
    return decideQueryRoute({
      query: input.query,
      agentAvailable: this.agentService !== undefined,
      hasAgentSession:
        (await this.agentService?.hasSession(input.sessionId, { includePersisted: true })) ?? false,
      databaseToggleVisible: isDatabaseToggleVisible(input.space),
      ...(input.enableDeepAnalysis !== undefined ? { enableDeepAnalysis: input.enableDeepAnalysis } : {}),
      ...(input.enableDatabase !== undefined ? { enableDatabase: input.enableDatabase } : {}),
      ...(input.retrievalMode !== undefined ? { retrievalMode: input.retrievalMode } : {}),
    });
  }

  shouldFallbackToAgentAfterNoHit(input: {
    noHit: boolean;
    strictKnowledgeOnly: boolean;
  }): boolean {
    return shouldFallbackToAgentAfterNoHit({
      ...input,
      agentAvailable: this.agentService !== undefined,
    });
  }

  async prepareAgentDispatch(input: {
    tenantId: string;
    userId: string;
    space: SpaceRow;
    spaces: SpaceRow[];
    spaceIds: string[];
    enableDatabase?: boolean;
  }): Promise<AgentDispatchContext> {
    const visibleDatabaseConfig = normalizeDatabaseConfig(input.space.database_config);
    const databaseSuppressed = input.spaceIds.length > 1 && input.enableDatabase === true;
    const enableDatabase = input.spaceIds.length === 1 && input.enableDatabase === true && visibleDatabaseConfig.enabled;
    const databaseMode: DatabaseMode = databaseSuppressed ? 'unavailable_multi_space' : enableDatabase ? 'enabled' : 'disabled';
    const databaseConfig = enableDatabase
      ? await decryptSpaceDatabaseConfig(this.db, input.space.database_config)
      : visibleDatabaseConfig;
    const agentOptions: AgentSpawnOptions = {
      tenantId: input.tenantId,
      userId: input.userId,
      allowedSpaces: input.spaces.map((space) => ({ id: space.id, name: space.name })),
      enableDatabase,
    };

    if (enableDatabase) {
      agentOptions.databaseConfig = databaseConfig;
    }

    return {
      databaseMode,
      agentOptions,
    };
  }
}

const AGENT_RETRIEVAL_MODES = new Set(['graph_rag', 'path_first', 'community_first']);

export function classifyIntent(query: string): Intent {
  if (/关系|依赖|调用|连接|之间|相互|架构|relationship|depends|calls/i.test(query)) {
    return 'relationship_explanation';
  }

  if (/为什么|原因|因果|导致|影响|why|cause|because/i.test(query)) {
    return 'architecture_reasoning';
  }

  if (/是什么|定义|含义|怎么用|what is|define/i.test(query)) {
    return 'fact_lookup';
  }

  if (/怎么做|步骤|流程|操作|how to|steps/i.test(query)) {
    return 'how_to';
  }

  if (/总结|汇总|概述|summary|overview/i.test(query)) {
    return 'summarization';
  }

  return 'fact_lookup';
}

export function decideQueryRoute(input: {
  query: string;
  agentAvailable: boolean;
  hasAgentSession?: boolean;
  enableDeepAnalysis?: boolean;
  enableDatabase?: boolean;
  databaseToggleVisible?: boolean;
  retrievalMode?: string;
}): QueryRoute {
  const intent = classifyIntent(input.query);
  if (!input.agentAvailable) {
    return { path: 'static_rag', reason: 'agent_unavailable', intent };
  }

  if (input.hasAgentSession === true) {
    return { path: 'agent', reason: 'bound_agent_session', intent };
  }

  if (input.enableDeepAnalysis === true) {
    return { path: 'agent', reason: 'deep_analysis_enabled', intent };
  }

  if (input.enableDatabase === true && input.databaseToggleVisible === true) {
    return { path: 'agent', reason: 'database_enabled', intent };
  }

  const retrievalMode = normalizeRetrievalMode(input.retrievalMode);
  if (AGENT_RETRIEVAL_MODES.has(retrievalMode)) {
    return { path: 'agent', reason: `retrieval_mode:${retrievalMode}`, intent };
  }

  if (intent === 'relationship_explanation' || intent === 'architecture_reasoning') {
    return { path: 'agent', reason: `intent:${intent}`, intent };
  }

  return { path: 'static_rag', reason: `intent:${intent}`, intent };
}

export function shouldFallbackToAgentAfterNoHit(input: {
  noHit: boolean;
  strictKnowledgeOnly: boolean;
  agentAvailable: boolean;
}): boolean {
  return input.noHit && input.strictKnowledgeOnly === false && input.agentAvailable;
}

function normalizeRetrievalMode(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized === undefined || normalized.length === 0 ? 'wiki_only' : normalized;
}
