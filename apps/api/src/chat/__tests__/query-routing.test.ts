import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { classifyIntent, decideQueryRoute, shouldFallbackToAgentAfterNoHit } from '../chat.service.js';

describe('query routing', () => {
  it('classifies supported lightweight intents', () => {
    expect(classifyIntent('A 和 B 之间是什么关系')).toBe('relationship_explanation');
    expect(classifyIntent('为什么索引会影响查询')).toBe('architecture_reasoning');
    expect(classifyIntent('SSO 是什么')).toBe('fact_lookup');
    expect(classifyIntent('怎么做索引重建')).toBe('how_to');
    expect(classifyIntent('summary of this space')).toBe('summarization');
  });

  it('routes bound conversations, explicit toggles, and named graph modes to Agent', () => {
    expect(baseRoute({ hasAgentSession: true })).toMatchObject({ path: 'agent', reason: 'bound_agent_session' });
    expect(baseRoute({ enableDeepAnalysis: true })).toMatchObject({ path: 'agent', reason: 'deep_analysis_enabled' });
    expect(baseRoute({ enableDatabase: true, databaseToggleVisible: true })).toMatchObject({
      path: 'agent',
      reason: 'database_enabled',
    });
    expect(baseRoute({ retrievalMode: 'graph_rag' })).toMatchObject({
      path: 'agent',
      reason: 'retrieval_mode:graph_rag',
    });
    expect(baseRoute({ retrievalMode: 'path_first' })).toMatchObject({
      path: 'agent',
      reason: 'retrieval_mode:path_first',
    });
    expect(baseRoute({ retrievalMode: 'community_first' })).toMatchObject({
      path: 'agent',
      reason: 'retrieval_mode:community_first',
    });
  });

  it('routes complex intents to Agent and simple intents to static RAG', () => {
    expect(baseRoute({ query: '解释服务之间的调用关系' })).toMatchObject({
      path: 'agent',
      intent: 'relationship_explanation',
    });
    expect(baseRoute({ query: 'why does the cache affect indexing?' })).toMatchObject({
      path: 'agent',
      intent: 'architecture_reasoning',
    });
    expect(baseRoute({ query: 'what is SSO?' })).toMatchObject({ path: 'static_rag', intent: 'fact_lookup' });
    expect(baseRoute({ query: 'how to rebuild an index?' })).toMatchObject({ path: 'static_rag', intent: 'how_to' });
    expect(baseRoute({ query: 'overview of permissions' })).toMatchObject({
      path: 'static_rag',
      intent: 'summarization',
    });
  });

  it('falls back to static RAG when Agent is unavailable', () => {
    expect(baseRoute({ query: '解释 A 和 B 的关系', agentAvailable: false })).toMatchObject({
      path: 'static_rag',
      reason: 'agent_unavailable',
    });
  });

  it('falls back from static no-hit to Agent only when strict knowledge mode is disabled', () => {
    expect(
      shouldFallbackToAgentAfterNoHit({
        noHit: true,
        strictKnowledgeOnly: false,
        agentAvailable: true,
      }),
    ).toBe(true);
    expect(
      shouldFallbackToAgentAfterNoHit({
        noHit: true,
        strictKnowledgeOnly: true,
        agentAvailable: true,
      }),
    ).toBe(false);
    expect(
      shouldFallbackToAgentAfterNoHit({
        noHit: true,
        strictKnowledgeOnly: false,
        agentAvailable: false,
      }),
    ).toBe(false);
  });
});

function baseRoute(overrides: Partial<Parameters<typeof decideQueryRoute>[0]> = {}) {
  return decideQueryRoute({
    query: 'what is SSO?',
    agentAvailable: true,
    databaseToggleVisible: false,
    ...overrides,
  });
}
