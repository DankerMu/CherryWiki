import type { DatabaseMode } from './chat-routing.service.js';

export type ChatUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type CitationResponse = {
  index: number;
  chunk_id: string;
  space_id?: string;
  wiki_page_pk: string;
  page_id: string;
  section_id: string | null;
  relevance_score: number;
  source_chain_json: Record<string, unknown>;
  display_text: string;
  page_title: string;
  section_title: string | null;
  fallback: boolean;
};

export type ChatStreamEvent =
  | { type: 'session'; session_id: string }
  | { type: 'content'; delta: string }
  | { type: 'citations'; citations: CitationResponse[] }
  | { type: 'usage'; usage: ChatUsage }
  | { type: 'agent.tool_use'; id?: string; name: string; input: Record<string, unknown> }
  | { type: 'chart.data'; data: Record<string, unknown> }
  | { type: 'message.completed'; database_mode?: DatabaseMode }
  | { type: 'error'; code: string; message: string };

export function emptyUsage(): ChatUsage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
}
