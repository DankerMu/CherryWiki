import { isAbsolute, relative, resolve } from 'node:path';

import type { AgentSpaceContext } from './dto/agent.dto.js';

export type AgentGraphPathInput = {
  spaceId: string;
  allowedSpaces?: AgentSpaceContext[];
  graphBasePath?: string;
};

export type NormalizedAgentSpace = {
  id: string;
  name?: string | null;
  graphPath?: string;
};

const DEFAULT_GRAPH_BASE_PATH = '/data/spaces';

export function normalizeAgentSpaces(input: AgentGraphPathInput): NormalizedAgentSpace[] {
  const spaces =
    input.allowedSpaces?.length === undefined || input.allowedSpaces.length === 0
      ? [{ id: input.spaceId }]
      : input.allowedSpaces;
  const graphBasePath = input.graphBasePath ?? process.env.CHERRY_GRAPHIFY_BASE_PATH ?? DEFAULT_GRAPH_BASE_PATH;

  return spaces.map((space) => {
    const normalized: NormalizedAgentSpace = { id: space.id };
    const graphPath = normalizeSpaceGraphPath(space, graphBasePath);

    if (space.name !== undefined) {
      normalized.name = space.name;
    }

    if (graphPath !== undefined) {
      normalized.graphPath = graphPath;
    }

    return normalized;
  });
}

export function collectAgentGraphPaths(input: AgentGraphPathInput): string[] {
  const paths = new Set<string>();

  for (const space of normalizeAgentSpaces(input)) {
    if (space.graphPath !== undefined) {
      paths.add(space.graphPath);
    }
  }

  return [...paths].sort();
}

export function normalizeGraphReadPath(rawPath: string | null | undefined): string | undefined {
  if (typeof rawPath !== 'string') {
    return undefined;
  }

  const trimmed = rawPath.trim();
  if (trimmed.length === 0 || !isAbsolute(trimmed) || containsTraversal(trimmed)) {
    return undefined;
  }

  return resolve(trimmed);
}

export function normalizeWorkDirReadPath(rawPath: string | null | undefined): string | undefined {
  if (typeof rawPath !== 'string') {
    return undefined;
  }

  const trimmed = rawPath.trim();
  return trimmed.length === 0 ? undefined : resolve(trimmed);
}

function normalizeSpaceGraphPath(space: AgentSpaceContext, graphBasePath: string): string | undefined {
  if (typeof space.graphPath === 'string' && space.graphPath.trim().length > 0) {
    return normalizeGraphReadPath(space.graphPath);
  }

  return normalizeDefaultGraphPath(graphBasePath, space.id);
}

function normalizeDefaultGraphPath(rawGraphBasePath: string, rawSpaceId: string): string | undefined {
  const graphBasePath = rawGraphBasePath.trim();
  const spaceId = rawSpaceId.trim();
  if (
    graphBasePath.length === 0 ||
    spaceId.length === 0 ||
    !isAbsolute(graphBasePath) ||
    isAbsolute(spaceId) ||
    containsTraversal(graphBasePath) ||
    containsTraversal(spaceId)
  ) {
    return undefined;
  }

  const resolvedBase = resolve(graphBasePath);
  const resolvedGraphPath = resolve(resolvedBase, spaceId, 'graphify-out', 'graph.json');
  return isWithinPath(resolvedBase, resolvedGraphPath) ? resolvedGraphPath : undefined;
}

function containsTraversal(value: string): boolean {
  return value.includes('..');
}

function isWithinPath(basePath: string, targetPath: string): boolean {
  const relativePath = relative(basePath, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}
