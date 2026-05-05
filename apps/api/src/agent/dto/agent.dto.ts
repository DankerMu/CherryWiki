import type { ChildProcess } from 'node:child_process';

export type AgentToolName = 'Bash' | 'Read';

export type AgentToolUseEvent = {
  type: 'agent.tool_use';
  id?: string;
  name: string;
  input: Record<string, unknown>;
};

export type AgentEvent =
  | { type: 'message.delta'; delta: string }
  | AgentToolUseEvent
  | { type: 'chart.data'; chart_type?: string; echarts_option?: unknown; data: Record<string, unknown> }
  | {
      type: 'message.completed';
      session_id?: string;
      result?: string;
      usage?: AgentUsage;
      total_cost_usd?: number;
      latency_ms?: number;
      first_sse_latency_ms?: number;
    }
  | { type: 'message.error'; code?: string; message: string };

export type AgentUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

export type AgentSpaceContext = {
  id: string;
  name?: string | null;
  graphPath?: string;
};

export type AgentDatabaseConfig = {
  enabled: boolean;
  dsn?: string;
  allowed_tables?: string[];
  masked_columns?: string[];
  description?: string;
};

export type AgentSpawnOptions = {
  tenantId?: string;
  userId?: string;
  allowedSpaces?: AgentSpaceContext[];
  enableDatabase?: boolean;
  databaseConfig?: AgentDatabaseConfig;
  apiInternalUrl?: string;
  agentToken?: string;
  graphBasePath?: string;
  command?: string;
  model?: string;
  modelConfigId?: string;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  maxConcurrentAgents?: number;
};

export type AgentSessionRecord = {
  conversationId: string;
  spaceId: string;
  sessionId: string;
  workDir: string;
  agentHome: string;
  lastActivityAt: number;
  processRef?: ChildProcess;
  options: AgentSpawnOptions;
};

export type AgentTiming = {
  spawn_at: Date;
  first_sse_at?: Date;
  completed_at?: Date;
};

export type AgentAuditContext = {
  tenantId: string;
  userId?: string;
  spaceId?: string;
  conversationId?: string;
};
