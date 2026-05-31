import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { OpenAIEmbeddingProvider, countTokens, type EmbeddingProviderConfig } from '@cherrygraph/ai-core';
import { ErrorCode, indexSnapshots, model_configs } from '@cherrygraph/shared';
import {
  DEFAULT_RETRIEVAL_CONFIG,
  retrieveFullGraphContext,
  retrieve,
  rrfFuseThreeSource,
  type Bm25SearchFn,
  type FusedRetrievalResult,
  type GraphCandidate,
  type RetrievalResult,
  type SearchHit,
  type SourceChainJson,
  type VectorSearchFn,
} from '@cherrygraph/rag-core';
import { GraphQueryService } from '@cherrygraph/graph-core';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { getApiLogger } from '../common/logger/logger.module.js';
import { validateAdminOutboundProbeUrl } from '../common/outbound-probe-safety.js';
import { throwApiError } from '../common/errors/api-error.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { GraphService } from '../graph/graph.service.js';
import { ModelConfigService, type RerankModelConfig } from '../models/model-config.service.js';
import { EMBEDDING_PROVIDER_FACTORY, type EmbeddingProviderFactory } from './chat.tokens.js';

type ChatDatabase = NodePgDatabase;
type ModelConfigRow = typeof model_configs.$inferSelect;
type IndexSnapshotRow = typeof indexSnapshots.$inferSelect;

export type ChatRetrievalPreparedCompletion = {
  tenantId: string;
  spaceIds: string[];
  userId: string;
  userGroupIds: string[];
  message: string;
  chatModel: ModelConfigRow;
};

export type GraphHint = {
  id: string;
  label: string;
  node_type: string | null;
  description: string | null;
  score: number;
  space_id: string;
  content: string;
};

export type RetrievedContext = {
  results: RetrievalResult[];
  graphContext: Array<GraphHint | GraphCandidate>;
  trace: {
    candidates: {
      vector: SearchHit[];
      bm25: SearchHit[];
      graph: Array<GraphHint | GraphCandidate>;
    };
    aclFiltered: {
      wiki: RetrievalResult[];
      graph: Array<GraphHint | GraphCandidate>;
    };
    finalContext: {
      wiki: Array<Pick<RetrievalResult, 'chunkId' | 'spaceId' | 'score' | 'pageTitle' | 'sectionTitle'>>;
      graph_hints: Array<GraphHint | GraphCandidate>;
      wiki_tokens: number;
      graph_tokens: number;
      rerank_model_id?: string;
      rerank_latency_ms?: number;
      rerank_status?: RerankStatus;
      rerank_skip_reason?: string;
    };
  };
};

type SearchRow = {
  id: string;
  content: string;
  wiki_page_pk: string;
  page_id: string | null;
  section_id: string | null;
  source_chain_json: Record<string, unknown> | null;
  injection_risk: boolean;
  page_title: string | null;
  section_title: string | null;
  score: string | number | null;
};

type SqlQueryResult<TRow> = {
  rows: TRow[];
};

type RerankStatus = 'success' | 'skipped' | 'timeout' | 'error';

type RerankMeta = {
  rerank_model_id?: string;
  rerank_latency_ms?: number;
  rerank_status: RerankStatus;
  rerank_skip_reason?: string;
};

type RerankApiResult = {
  index: number;
  relevance_score: number;
};

const RETRIEVAL_TOP_K = 8;
const RERANK_TIMEOUT_MS = 3000;

@Injectable()
export class ChatRetrievalService {
  private readonly embeddingProviderFactory: EmbeddingProviderFactory;
  private readonly graphQueryService: GraphQueryService;

  constructor(
    @Inject(DRIZZLE) private readonly db: ChatDatabase,
    @Optional() @Inject(EMBEDDING_PROVIDER_FACTORY) embeddingProviderFactory?: EmbeddingProviderFactory,
    @Optional() private readonly graphService?: GraphService,
    @Optional() private readonly modelConfigService?: ModelConfigService,
  ) {
    this.embeddingProviderFactory =
      embeddingProviderFactory ??
      ((config: EmbeddingProviderConfig) => new OpenAIEmbeddingProvider(config));
    this.graphQueryService = new GraphQueryService(db);
  }

  emptyContext(): RetrievedContext {
    return emptyRetrievedContext();
  }

  async findActivatedSnapshots(
    tenantId: string,
    spaceIds: string[],
  ): Promise<Array<{ spaceId: string; snapshot: IndexSnapshotRow }>> {
    const snapshots: Array<{ spaceId: string; snapshot: IndexSnapshotRow }> = [];

    for (const spaceId of spaceIds) {
      const snapshot = await this.findActivatedSnapshot(tenantId, spaceId);
      if (snapshot !== undefined) {
        snapshots.push({ spaceId, snapshot });
      }
    }

    return snapshots;
  }

  async retrieveContext(
    prepared: ChatRetrievalPreparedCompletion,
    spaceSnapshots: Array<{ spaceId: string; snapshot: IndexSnapshotRow }>,
    retrievalModeInput?: string,
  ): Promise<RetrievedContext> {
    if (spaceSnapshots.length === 0) {
      return emptyRetrievedContext();
    }

    const retrievalMode = normalizeContextRetrievalMode(retrievalModeInput);
    const includeGraph = retrievalMode !== 'wiki_only';
    const candidates: RetrievedContext['trace']['candidates'] = {
      vector: [],
      bm25: [],
      graph: [],
    };
    const vectorSearch = this.createVectorSearchFn();
    const bm25Search = this.createBm25SearchFn();
    const modelGroups = new Map<string, Array<{ spaceId: string; snapshot: IndexSnapshotRow }>>();

    for (const entry of spaceSnapshots) {
      const group = modelGroups.get(entry.snapshot.embedding_model_id) ?? [];
      group.push(entry);
      modelGroups.set(entry.snapshot.embedding_model_id, group);
    }

    let results: RetrievalResult[] = [];
    let graphContext: Array<GraphHint | GraphCandidate> = [];
    const allVectorHits: SearchHit[] = [];
    const allBm25Hits: SearchHit[] = [];

    for (const groupSnapshots of modelGroups.values()) {
      const firstSnapshot = groupSnapshots[0]?.snapshot;
      if (firstSnapshot === undefined) {
        continue;
      }

      const embeddingModel = await this.resolveSnapshotEmbeddingModel(prepared.tenantId, firstSnapshot);
      const embeddingProvider = this.embeddingProviderFactory(toEmbeddingProviderConfig(embeddingModel));
      const [queryEmbedding] = await embeddingProvider.embedBatch([prepared.message]);

      if (queryEmbedding === undefined || queryEmbedding.length === 0) {
        continue;
      }

      const snapshotsBySpace = Object.fromEntries(
        groupSnapshots.map(({ spaceId, snapshot }) => [spaceId, snapshot.id]),
      );
      const groupResults = await retrieve(
        {
          query: prepared.message,
          queryEmbedding,
          tenantId: prepared.tenantId,
          spaceIds: Object.keys(snapshotsBySpace),
          userGroupIds: prepared.userGroupIds,
          snapshotsBySpace,
          topK: RETRIEVAL_TOP_K,
        },
        async (params) => {
          const hits = await vectorSearch(params);
          candidates.vector.push(...hits);
          allVectorHits.push(...hits.map((hit) => ({ ...hit, spaceId: params.spaceId })));
          return hits;
        },
        async (params) => {
          const hits = await bm25Search(params);
          candidates.bm25.push(...hits);
          allBm25Hits.push(...hits.map((hit) => ({ ...hit, spaceId: params.spaceId })));
          return hits;
        },
      );

      results.push(...groupResults);
    }

    if (includeGraph) {
      const activeRunIds = activeGraphifyRunIdsFromSnapshots(spaceSnapshots);
      if (activeRunIds.size > 0) {
        let graphCandidates: GraphCandidate[] = [];
        try {
          graphCandidates = await retrieveFullGraphContext(
            {
              query: prepared.message,
              spaceIds: prepared.spaceIds,
              activeRunIds,
            },
            this.graphQueryService,
          );
        } catch (err) {
          getApiLogger().warn(
            { err, tenant_id: prepared.tenantId, space_ids: prepared.spaceIds },
            'Full graph retrieval failed; continuing with wiki retrieval only',
          );
        }
        candidates.graph.push(...graphCandidates);

        if (graphCandidates.length > 0) {
          allVectorHits.sort((left, right) => right.score - left.score);
          allBm25Hits.sort((left, right) => right.score - left.score);
          const fusedTopK = allVectorHits.length + allBm25Hits.length + graphCandidates.length;
          const fusedResults = rrfFuseThreeSource(allVectorHits, allBm25Hits, graphCandidates, {
            topK: fusedTopK,
          });
          results = fusedResults
            .filter((result): result is Extract<FusedRetrievalResult, { type: 'wiki_chunk' }> => result.type === 'wiki_chunk')
            .map((result) => ({
              ...result.hit,
              score: result.score,
            }));
          graphContext = truncateGraphContextForBudget(
            fusedResults
              .filter((result): result is Extract<FusedRetrievalResult, { type: 'graph' }> => result.type === 'graph')
              .map((result) => ({ ...result.candidate, score: result.score })),
            prepared.chatModel.model_id,
            DEFAULT_RETRIEVAL_CONFIG.graph_context_budget,
          );
        }
      }
    }

    results = results.sort((left, right) => right.score - left.score).slice(0, RETRIEVAL_TOP_K);
    const rerankOutcome = await this.rerankRetrievedResults(prepared, results);
    results = rerankOutcome.results;

    return buildRetrievedContext(prepared, results, graphContext, candidates, rerankOutcome.meta);
  }

  async withWikiOnlyGraphHints(
    prepared: ChatRetrievalPreparedCompletion,
    context: RetrievedContext,
    retrievalModeInput?: string,
  ): Promise<RetrievedContext> {
    if (context.graphContext.length > 0 || normalizeContextRetrievalMode(retrievalModeInput) !== 'wiki_only') {
      return context;
    }

    const graphHints = await this.retrieveGraphHints(prepared);
    if (graphHints.length === 0) {
      return context;
    }

    return appendGraphHintsToRetrievedContext(context, graphHints, prepared.chatModel.model_id);
  }

  private async findActivatedSnapshot(tenantId: string, spaceId: string): Promise<IndexSnapshotRow | undefined> {
    const [snapshot] = await this.db
      .select()
      .from(indexSnapshots)
      .where(
        and(
          eq(indexSnapshots.tenant_id, tenantId),
          eq(indexSnapshots.space_id, spaceId),
          eq(indexSnapshots.status, 'activated'),
        ),
      )
      .orderBy(desc(indexSnapshots.activated_at))
      .limit(1);

    return snapshot;
  }

  private async resolveSnapshotEmbeddingModel(tenantId: string, snapshot: IndexSnapshotRow): Promise<ModelConfigRow> {
    const [model] = await this.db
      .select()
      .from(model_configs)
      .where(and(eq(model_configs.tenant_id, tenantId), eq(model_configs.id, snapshot.embedding_model_id)))
      .limit(1);

    if (model === undefined || model.encrypted_api_key_ref === null) {
      throwApiError(ErrorCode.NO_EMBEDDING_MODEL_CONFIGURED, 'No embedding model configured for activated index snapshot', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    return model;
  }

  private async rerankRetrievedResults(
    prepared: ChatRetrievalPreparedCompletion,
    results: RetrievalResult[],
  ): Promise<{ results: RetrievalResult[]; meta: RerankMeta }> {
    if (results.length === 0) {
      return {
        results,
        meta: {
          rerank_status: 'skipped',
          rerank_skip_reason: 'empty_results',
        },
      };
    }

    if (this.modelConfigService === undefined) {
      return {
        results,
        meta: {
          rerank_status: 'skipped',
          rerank_skip_reason: 'model_config_service_unavailable',
        },
      };
    }

    const startedAt = Date.now();
    let config: RerankModelConfig | null = null;

    try {
      config = await this.modelConfigService.getEnabledRerankModel(prepared.tenantId);
      if (config === null) {
        return {
          results,
          meta: {
            rerank_status: 'skipped',
            rerank_skip_reason: 'no_rerank_model',
          },
        };
      }

      if (config.base_url === null) {
        return {
          results,
          meta: {
            rerank_model_id: config.id,
            rerank_status: 'skipped',
            rerank_skip_reason: 'missing_base_url',
          },
        };
      }

      const rankedResults = await this.callRerankApi(prepared, results, config);
      return {
        results: rankedResults,
        meta: {
          rerank_model_id: config.id,
          rerank_latency_ms: elapsedMs(startedAt),
          rerank_status: 'success',
        },
      };
    } catch (err) {
      const status: RerankStatus = isAbortError(err) ? 'timeout' : 'error';
      getApiLogger().warn(
        {
          err,
          tenant_id: prepared.tenantId,
          rerank_model_id: config?.id,
        },
        'Rerank request failed; keeping RRF retrieval order',
      );

      return {
        results,
        meta: {
          ...(config !== null ? { rerank_model_id: config.id } : {}),
          rerank_latency_ms: elapsedMs(startedAt),
          rerank_status: status,
        },
      };
    }
  }

  private async callRerankApi(
    prepared: ChatRetrievalPreparedCompletion,
    results: RetrievalResult[],
    config: RerankModelConfig,
  ): Promise<RetrievalResult[]> {
    const apiKey = this.modelConfigService!.resolveApiKey(config.encrypted_api_key_ref);
    const targetValidation = await validateAdminOutboundProbeUrl(config.base_url!, { dnsTimeoutMs: 2000 });
    if (!targetValidation.ok) {
      throw new Error(`Rerank URL validation failed: ${targetValidation.error}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);

    try {
      const response = await fetch(`${targetValidation.url.toString().replace(/\/+$/, '')}/rerank`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model_id,
          query: prepared.message,
          documents: results.map((result) => result.content),
          top_n: results.length,
        }),
        signal: controller.signal,
        dispatcher: targetValidation.dispatcher,
      });

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Rerank API returned ${response.status}`);
      }

      const payload = (await response.json()) as { results?: unknown };
      const rerankResults = parseRerankResults(payload.results);
      if (rerankResults.length === 0) {
        throw new Error('Rerank API returned no valid results');
      }

      return reorderByRerankScores(results, rerankResults);
    } finally {
      clearTimeout(timeout);
      await targetValidation.dispatcher.close().catch(() => undefined);
    }
  }

  private async retrieveGraphHints(prepared: ChatRetrievalPreparedCompletion): Promise<GraphHint[]> {
    if (this.graphService === undefined) {
      return [];
    }

    try {
      const results = await Promise.allSettled(
        prepared.spaceIds.map((spaceId) =>
          this.graphService!.searchNodes(
            {
              q: prepared.message,
              space_id: spaceId,
              top_k: 5,
            },
            {
              tenantId: prepared.tenantId,
              actorUserId: prepared.userId,
              userId: prepared.userId,
              userGroupIds: prepared.userGroupIds,
            },
          ),
        ),
      );
      const hintsById = new Map<string, GraphHint>();

      for (const result of results) {
        if (result.status !== 'fulfilled' || result.value === undefined) {
          continue;
        }

        for (const node of result.value.nodes) {
          if (!hintsById.has(node.id)) {
            hintsById.set(node.id, toGraphHint(node));
          }
        }
      }

      return Array.from(hintsById.values())
        .sort((left, right) => right.score - left.score)
        .slice(0, 5);
    } catch {
      return [];
    }
  }

  private createVectorSearchFn(): VectorSearchFn {
    return async (params): Promise<SearchHit[]> => {
      const query = sql`
        SELECT wc.id, wc.content, wc.wiki_page_pk, wp.page_id, wc.section_id, wc.source_chain_json,
               wc.injection_risk, wp.title as page_title, ws.heading as section_title,
               1 - (e.embedding <=> ${toPgVectorLiteral(params.queryEmbedding)}::vector) as score
        FROM wiki_chunks wc
        JOIN embeddings e ON e.chunk_id = wc.id
        LEFT JOIN wiki_pages wp ON wp.id = wc.wiki_page_pk
        LEFT JOIN wiki_sections ws ON ws.id = wc.section_id
        WHERE wc.index_snapshot_id = ${params.snapshotId}
          AND wc.tenant_id = ${params.tenantId}
          AND wc.space_id = ${params.spaceId}
          AND wc.acl_json->>'space_id' = ${params.spaceId}
          AND wp.status = 'published'
          AND (
            wc.acl_json->'allowed_group_ids' ?| ${toPgTextArray(params.userGroupIds)}
            OR wc.acl_json->'allowed_group_ids' = '[]'::jsonb
          )
        ORDER BY e.embedding <=> ${toPgVectorLiteral(params.queryEmbedding)}::vector ASC
        LIMIT ${params.topN}
      `;
      const result = await this.db.execute<SearchRow>(query);

      return normalizeSearchRows(result, params.spaceId);
    };
  }

  private createBm25SearchFn(): Bm25SearchFn {
    return async (params): Promise<SearchHit[]> => {
      const tsQuery = toSimpleTsQuery(params.query);
      if (tsQuery.length === 0) {
        return [];
      }

      const query = sql`
        SELECT wc.id, wc.content, wc.wiki_page_pk, wp.page_id, wc.section_id, wc.source_chain_json,
               wc.injection_risk, wp.title as page_title, ws.heading as section_title,
               ts_rank_cd(to_tsvector('simple', wc.content), to_tsquery('simple', ${tsQuery})) as score
        FROM wiki_chunks wc
        LEFT JOIN wiki_pages wp ON wp.id = wc.wiki_page_pk
        LEFT JOIN wiki_sections ws ON ws.id = wc.section_id
        WHERE wc.index_snapshot_id = ${params.snapshotId}
          AND wc.tenant_id = ${params.tenantId}
          AND wc.space_id = ${params.spaceId}
          AND wc.acl_json->>'space_id' = ${params.spaceId}
          AND wp.status = 'published'
          AND (
            wc.acl_json->'allowed_group_ids' ?| ${toPgTextArray(params.userGroupIds)}
            OR wc.acl_json->'allowed_group_ids' = '[]'::jsonb
          )
          AND to_tsvector('simple', wc.content) @@ to_tsquery('simple', ${tsQuery})
        ORDER BY score DESC
        LIMIT ${params.topN}
      `;
      const result = await this.db.execute<SearchRow>(query);

      return normalizeSearchRows(result, params.spaceId);
    };
  }
}

function buildRetrievedContext(
  prepared: ChatRetrievalPreparedCompletion,
  results: RetrievalResult[],
  graphContext: Array<GraphHint | GraphCandidate>,
  candidates: RetrievedContext['trace']['candidates'],
  rerankMeta: RerankMeta,
): RetrievedContext {
  return {
    results,
    graphContext,
    trace: {
      candidates,
      aclFiltered: {
        wiki: results,
        graph: candidates.graph,
      },
      finalContext: {
        wiki: results.map((result) => ({
          chunkId: result.chunkId,
          spaceId: result.spaceId,
          score: result.score,
          pageTitle: result.pageTitle,
          sectionTitle: result.sectionTitle,
        })),
        graph_hints: graphContext,
        wiki_tokens: results.reduce(
          (total, result) => total + countTokens(result.content, prepared.chatModel.model_id),
          0,
        ),
        graph_tokens: graphContext.reduce(
          (total, candidate) => total + countTokens(candidate.content, prepared.chatModel.model_id),
          0,
        ),
        ...rerankMeta,
      },
    },
  };
}

function appendGraphHintsToRetrievedContext(
  context: RetrievedContext,
  graphHints: GraphHint[],
  modelId: string,
): RetrievedContext {
  return {
    ...context,
    graphContext: graphHints,
    trace: {
      candidates: {
        ...context.trace.candidates,
        graph: [...context.trace.candidates.graph, ...graphHints],
      },
      aclFiltered: {
        ...context.trace.aclFiltered,
        graph: [...context.trace.aclFiltered.graph, ...graphHints],
      },
      finalContext: {
        ...context.trace.finalContext,
        graph_hints: [...context.trace.finalContext.graph_hints, ...graphHints],
        graph_tokens:
          context.trace.finalContext.graph_tokens +
          graphHints.reduce((total, hint) => total + countTokens(hint.content, modelId), 0),
      },
    },
  };
}

function emptyRetrievedContext(): RetrievedContext {
  return {
    results: [],
    graphContext: [],
    trace: {
      candidates: {
        vector: [],
        bm25: [],
        graph: [],
      },
      aclFiltered: {
        wiki: [],
        graph: [],
      },
      finalContext: {
        wiki: [],
        graph_hints: [],
        wiki_tokens: 0,
        graph_tokens: 0,
      },
    },
  };
}

function toEmbeddingProviderConfig(model: ModelConfigRow): EmbeddingProviderConfig {
  if (model.encrypted_api_key_ref === null) {
    throwApiError(ErrorCode.NO_EMBEDDING_MODEL_CONFIGURED, 'No enabled embedding model configured', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  return {
    provider: model.provider,
    modelId: model.model_id,
    encryptedApiKeyRef: model.encrypted_api_key_ref,
    ...(model.base_url !== null ? { baseUrl: model.base_url } : {}),
    ...(model.embedding_dim !== null ? { embeddingDim: model.embedding_dim } : {}),
  };
}

function normalizeSearchRows(result: SqlQueryResult<SearchRow>, spaceId: string): SearchHit[] {
  return result.rows.map((row) => ({
    chunkId: row.id,
    spaceId,
    content: row.content,
    score: normalizeScore(row.score),
    wikiPagePk: row.wiki_page_pk,
    sectionId: row.section_id,
    sourceChainJson: { ...normalizeSourceChainJson(row.source_chain_json), page_id: row.page_id ?? row.wiki_page_pk },
    injectionRisk: row.injection_risk,
    pageTitle: row.page_title ?? 'Untitled',
    sectionTitle: row.section_title,
  }));
}

function normalizeJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeSourceChainJson(value: unknown): SourceChainJson {
  const record = normalizeJsonRecord(value);
  const edgeConfidences = record.edge_confidences;

  return {
    source_document_ids: normalizeStringArray(record.source_document_ids),
    graph_node_ids: normalizeStringArray(record.graph_node_ids),
    graph_edge_ids: normalizeStringArray(record.graph_edge_ids),
    edge_confidences: Array.isArray(edgeConfidences)
      ? edgeConfidences.filter(isEdgeConfidence)
      : [],
    chain_confidence: typeof record.chain_confidence === 'number' ? record.chain_confidence : 0,
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isEdgeConfidence(value: unknown): value is SourceChainJson['edge_confidences'][number] {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.edge_id === 'string' &&
    typeof record.confidence === 'number' &&
    typeof record.label === 'string'
  );
}

function normalizeScore(value: string | number | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toPgVectorLiteral(values: number[]): string {
  return `[${values.map(normalizeVectorValue).join(',')}]`;
}

function normalizeVectorValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return String(value);
}

function toPgTextArray(values: string[]): SQL {
  if (values.length === 0) {
    return sql`ARRAY[]::text[]`;
  }

  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]`;
}

function toSimpleTsQuery(query: string): string {
  return query
    .split(/[^\p{L}\p{N}_]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .map((term) => term.replace(/[':*!&|()]/g, ''))
    .filter((term) => term.length > 0)
    .join(' & ');
}

function normalizeRetrievalMode(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized === undefined || normalized.length === 0 ? 'wiki_only' : normalized;
}

function normalizeContextRetrievalMode(value: string | undefined): string {
  return normalizeRetrievalMode(value);
}

function truncateGraphContextForBudget<T extends { content: string }>(
  candidates: T[],
  modelId: string,
  budget: number,
): T[] {
  const selected: T[] = [];
  let used = 0;

  for (const candidate of candidates) {
    const tokens = countTokens(candidate.content, modelId);
    if (used + tokens > budget) {
      continue;
    }

    selected.push(candidate);
    used += tokens;
  }

  return selected;
}

function parseRerankResults(value: unknown): RerankApiResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): RerankApiResult[] => {
    if (!isRecord(item)) {
      return [];
    }

    const index = Number(item.index);
    const relevanceScore = Number(item.relevance_score);
    if (!Number.isInteger(index) || index < 0 || !Number.isFinite(relevanceScore)) {
      return [];
    }

    return [{ index, relevance_score: relevanceScore }];
  });
}

function reorderByRerankScores(results: RetrievalResult[], rerankResults: RerankApiResult[]): RetrievalResult[] {
  const scoresByIndex = new Map<number, number>();
  for (const item of rerankResults) {
    if (item.index < results.length) {
      scoresByIndex.set(item.index, item.relevance_score);
    }
  }

  if (scoresByIndex.size === 0) {
    throw new Error('Rerank API returned no usable scores');
  }

  return results
    .map((result, index) => ({
      result: scoresByIndex.has(index) ? { ...result, score: scoresByIndex.get(index)! } : result,
      index,
      rerankScore: scoresByIndex.get(index) ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((left, right) => {
      if (right.rerankScore !== left.rerankScore) {
        return right.rerankScore - left.rerankScore;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.result);
}

function elapsedMs(startedAt: number): number {
  return Math.max(1, Date.now() - startedAt);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function activeGraphifyRunIdsFromSnapshots(
  spaceSnapshots: Array<{ spaceId: string; snapshot: IndexSnapshotRow }>,
): Map<string, string> {
  const activeRunIds = new Map<string, string>();

  for (const { spaceId, snapshot } of spaceSnapshots) {
    const runId = snapshot.graphify_run_id?.trim();
    if (runId !== undefined && runId.length > 0) {
      activeRunIds.set(spaceId, runId);
    }
  }

  return activeRunIds;
}

function toGraphHint(node: {
  id: string;
  label: string;
  node_type: string | null;
  description?: string | null | undefined;
  score: number;
  space_id: string;
}): GraphHint {
  const description = node.description?.trim() ?? null;
  const type = node.node_type ?? 'unknown';
  return {
    id: node.id,
    label: node.label,
    node_type: node.node_type,
    description,
    score: node.score,
    space_id: node.space_id,
    content:
      description === null || description.length === 0
        ? `${node.label} (${type})`
        : `${node.label} (${type}): ${description}`,
  };
}
