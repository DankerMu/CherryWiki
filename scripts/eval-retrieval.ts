import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type RetrievalMode = 'wiki_only' | 'graph_rag';

export interface EvalEntry {
  query: string;
  expected_pages: string[];
  expected_content_snippet: string;
  space_id: string;
}

export interface RetrievalRequest {
  query: string;
  spaceId: string;
  mode: RetrievalMode;
  k: number;
}

export interface RetrievalResult {
  page: string;
  score: number;
}

export type RetrievalFunction = (request: RetrievalRequest) => Promise<RetrievalResult[]> | RetrievalResult[];

export type StaticRetrievalResults = Partial<Record<RetrievalMode, Record<string, RetrievalResult[]>>>;

export interface QueryEvaluationResult {
  entry: EvalEntry;
  retrievedPages: string[];
  recallAt8: number;
  reciprocalRank: number;
}

export interface ModeEvaluationResult {
  mode: RetrievalMode;
  queries: QueryEvaluationResult[];
  metrics: EvaluationMetrics;
}

export interface EvaluationMetrics {
  recallAt8: number;
  mrr: number;
}

const DEFAULT_EVAL_SET_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../tests/e2e/fixtures/golden/eval-set.json',
);

const PAGE_IDS = ['auth-system', 'jwt-authentication', 'permission-system', 'rbac-permission-model', 'index'] as const;

type PageId = (typeof PAGE_IDS)[number];

interface PageFixture {
  id: PageId;
  title: string;
  aliases: string[];
  keywords: string[];
  graphNeighbors: PageId[];
}

const PAGE_FIXTURES: PageFixture[] = [
  {
    id: 'auth-system',
    title: 'Auth System',
    aliases: ['auth', 'authentication', 'login', 'session management', 'access control'],
    keywords: [
      'jwt',
      'access',
      'control',
      'login',
      'token',
      'lifecycle',
      'session',
      'device',
      'ip',
      'activity',
      'refresh',
      'rotation',
      'rbac',
    ],
    graphNeighbors: ['jwt-authentication', 'rbac-permission-model', 'permission-system'],
  },
  {
    id: 'jwt-authentication',
    title: 'JWT Authentication',
    aliases: ['jwt', 'jwt authentication', 'bearer', 'access token', 'refresh token'],
    keywords: [
      'jwt',
      'token',
      'tokens',
      'access',
      'refresh',
      'ttl',
      'rotation',
      'bearer',
      'signature',
      'sessions',
      'revocation',
      'audit',
      'rate',
      'limited',
      'authorization',
      'login',
      'credentials',
    ],
    graphNeighbors: ['auth-system', 'rbac-permission-model'],
  },
  {
    id: 'permission-system',
    title: 'Permission System',
    aliases: ['permission', 'permissions', 'space permissions', 'permission version'],
    keywords: [
      'permission',
      'permissions',
      'space',
      'spaces',
      'rbac',
      'role',
      'roles',
      'group',
      'groups',
      'viewer',
      'editor',
      'admin',
      'read',
      'write',
      'version',
      'revocation',
      'revocations',
      '5',
      'seconds',
      'cache',
    ],
    graphNeighbors: ['rbac-permission-model', 'auth-system'],
  },
  {
    id: 'rbac-permission-model',
    title: 'RBAC Permission Model',
    aliases: ['rbac', 'rbac permission model', 'role hierarchy', 'group-based assignment'],
    keywords: [
      'rbac',
      'permission',
      'permissions',
      'role',
      'roles',
      'hierarchy',
      'viewer',
      'editor',
      'admin',
      'groups',
      'group',
      'spaces',
      'space',
      'effective',
      'maximum',
      'authorization',
      'jwt',
      'session',
    ],
    graphNeighbors: ['permission-system', 'jwt-authentication', 'auth-system'],
  },
  {
    id: 'index',
    title: 'Wiki Index',
    aliases: ['wiki index', 'generated wiki', 'pages', 'communities', 'god nodes'],
    keywords: ['wiki', 'index', 'generated', 'graphify', 'pages', 'communities', 'god', 'nodes', 'statistics'],
    graphNeighbors: [],
  },
];

export async function loadEvalSet(evalSetPath = DEFAULT_EVAL_SET_PATH): Promise<EvalEntry[]> {
  const raw = await readFile(evalSetPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`Eval set must be a JSON array: ${evalSetPath}`);
  }

  return parsed.map((entry, index) => validateEvalEntry(entry, index));
}

export function computeRecallAtK(expectedPages: string[], retrievedPages: string[], k = 8): number {
  if (expectedPages.length === 0) {
    return 0;
  }

  const topK = new Set(retrievedPages.slice(0, k));
  const hits = expectedPages.filter((page) => topK.has(page)).length;
  return hits / expectedPages.length;
}

export function computeMRR(expectedPages: string[], retrievedPages: string[]): number {
  const expected = new Set(expectedPages);
  const firstHitIndex = retrievedPages.findIndex((page) => expected.has(page));
  return firstHitIndex === -1 ? 0 : 1 / (firstHitIndex + 1);
}

export function computeMeanMetrics(results: QueryEvaluationResult[]): EvaluationMetrics {
  if (results.length === 0) {
    return { recallAt8: 0, mrr: 0 };
  }

  const totals = results.reduce(
    (acc, result) => ({
      recallAt8: acc.recallAt8 + result.recallAt8,
      mrr: acc.mrr + result.reciprocalRank,
    }),
    { recallAt8: 0, mrr: 0 },
  );

  return {
    recallAt8: totals.recallAt8 / results.length,
    mrr: totals.mrr / results.length,
  };
}

export class RetrievalEvaluator {
  constructor(
    private readonly retrieve: RetrievalFunction = createDeterministicFixtureRetriever(),
    private readonly k = 8,
  ) {}

  async evaluate(evalSet: EvalEntry[], modes: RetrievalMode[] = ['wiki_only', 'graph_rag']): Promise<ModeEvaluationResult[]> {
    const modeResults: ModeEvaluationResult[] = [];

    for (const mode of modes) {
      const queryResults: QueryEvaluationResult[] = [];

      for (const entry of evalSet) {
        const retrievalResults = await this.retrieve({
          query: entry.query,
          spaceId: entry.space_id,
          mode,
          k: this.k,
        });
        const retrievedPages = retrievalResults.map((result) => result.page);

        queryResults.push({
          entry,
          retrievedPages,
          recallAt8: computeRecallAtK(entry.expected_pages, retrievedPages, this.k),
          reciprocalRank: computeMRR(entry.expected_pages, retrievedPages),
        });
      }

      modeResults.push({
        mode,
        queries: queryResults,
        metrics: computeMeanMetrics(queryResults),
      });
    }

    return modeResults;
  }
}

export function createDeterministicFixtureRetriever(): RetrievalFunction {
  return ({ query, mode, k }) => {
    const queryTerms = tokenize(query);
    const scoredPages = PAGE_FIXTURES.map((page) => {
      const wikiScore = scorePage(queryTerms, page);
      const graphScore =
        mode === 'graph_rag'
          ? page.graphNeighbors.reduce((total, neighborId) => {
              const neighbor = PAGE_FIXTURES.find((candidate) => candidate.id === neighborId);
              return total + (neighbor ? scorePage(queryTerms, neighbor) * 0.35 : 0);
            }, 0)
          : 0;

      return {
        page: page.id,
        score: wikiScore + graphScore,
      };
    });

    return scoredPages
      .sort((a, b) => b.score - a.score || PAGE_IDS.indexOf(a.page as PageId) - PAGE_IDS.indexOf(b.page as PageId))
      .slice(0, k);
  };
}

export function createStaticRetriever(resultsByModeAndQuery: StaticRetrievalResults): RetrievalFunction {
  return ({ query, mode, k }) => (resultsByModeAndQuery[mode]?.[query] ?? []).slice(0, k);
}

export function formatComparisonTable(results: ModeEvaluationResult[]): string {
  const byMode = new Map(results.map((result) => [result.mode, result.metrics]));
  const rows = [
    ['Metric', 'wiki_only', 'graph_rag'],
    ['recall@8', formatMetric(byMode.get('wiki_only')?.recallAt8), formatMetric(byMode.get('graph_rag')?.recallAt8)],
    ['MRR', formatMetric(byMode.get('wiki_only')?.mrr), formatMetric(byMode.get('graph_rag')?.mrr)],
  ];

  const widths = [14, 11, 11];
  const horizontal = (left: string, middle: string, right: string) =>
    `${left}${widths.map((width) => '─'.repeat(width)).join(middle)}${right}`;
  const row = (cells: string[]) =>
    `│${cells.map((cell, index) => ` ${cell.padEnd(widths[index] - 2)} `).join('│')}│`;

  return [
    horizontal('┌', '┬', '┐'),
    row(rows[0]),
    horizontal('├', '┼', '┤'),
    row(rows[1]),
    row(rows[2]),
    horizontal('└', '┴', '┘'),
  ].join('\n');
}

export async function runEvaluation(options: { evalSetPath?: string; retrieve?: RetrievalFunction; k?: number } = {}): Promise<string> {
  const evalSet = await loadEvalSet(options.evalSetPath);
  const evaluator = new RetrievalEvaluator(options.retrieve, options.k ?? 8);
  const results = await evaluator.evaluate(evalSet);
  return formatComparisonTable(results);
}

function validateEvalEntry(entry: unknown, index: number): EvalEntry {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Eval entry ${index} must be an object`);
  }

  const candidate = entry as Partial<EvalEntry>;
  if (
    typeof candidate.query !== 'string' ||
    !Array.isArray(candidate.expected_pages) ||
    candidate.expected_pages.some((page) => typeof page !== 'string') ||
    typeof candidate.expected_content_snippet !== 'string' ||
    typeof candidate.space_id !== 'string'
  ) {
    throw new Error(`Eval entry ${index} has invalid shape`);
  }

  return {
    query: candidate.query,
    expected_pages: candidate.expected_pages,
    expected_content_snippet: candidate.expected_content_snippet,
    space_id: candidate.space_id,
  };
}

function scorePage(queryTerms: string[], page: PageFixture): number {
  const titleTerms = tokenize(page.title);
  const aliasTerms = page.aliases.flatMap((alias) => tokenize(alias));
  const keywordSet = new Set(page.keywords);
  const titleSet = new Set(titleTerms);
  const aliasSet = new Set(aliasTerms);

  return queryTerms.reduce((score, term) => {
    if (titleSet.has(term)) {
      return score + 3;
    }
    if (aliasSet.has(term)) {
      return score + 2;
    }
    if (keywordSet.has(term)) {
      return score + 1;
    }
    return score;
  }, 0);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function formatMetric(value: number | undefined): string {
  return (value ?? 0).toFixed(3);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const table = await runEvaluation();
  console.log(table);
}
