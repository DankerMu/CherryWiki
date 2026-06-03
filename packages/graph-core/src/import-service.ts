import { detectCommunities } from './communities.js';
import { mapConfidence } from './confidence.js';
import { computeStableKey } from './stable-key.js';
import type {
  ConfidenceLabel,
  ImportOperation,
  ImportRunOptions,
  ValidGraphOutput,
} from './types.js';
import { isConfidenceLabel } from './validator.js';

function sourceRefsFor(
  sourceFile: string | undefined,
  sourceLocation: string | undefined,
): unknown[] {
  if (sourceFile === undefined || sourceFile.length === 0) {
    return [];
  }

  return [
    {
      file: sourceFile,
      ...(sourceLocation === undefined ? {} : { location: sourceLocation }),
    },
  ];
}

function emptyImportOperation(warnings: string[]): ImportOperation {
  return {
    nodes: [],
    edges: [],
    communities: [],
    aliases: [],
    stats: {
      nodesCreated: 0,
      nodesMatched: 0,
      edgesCreated: 0,
      communitiesCreated: 0,
      aliasesCreated: 0,
      warnings,
      shrinkDetected: true,
    },
  };
}

export class GraphImportService {
  prepareImport(
    spaceId: string,
    graphOutput: ValidGraphOutput,
    existingStableKeys: Set<string> = new Set<string>(),
    previousNodeCount?: number,
  ): ImportOperation {
    if (previousNodeCount !== undefined) {
      const deviation = 1 - graphOutput.validNodes.length / previousNodeCount;
      if (deviation > 0.8) {
        return emptyImportOperation([`shrink guard: ${Math.round(deviation * 100)}% deviation`]);
      }
    }

    // assignments map node.id -> LOCAL community_key (e.g. 'community-1', or the
    // original node.community in backward-compat mode), NOT a graph_communities PK.
    const { assignments, communities } = detectCommunities(
      graphOutput.validNodes,
      graphOutput.validEdges,
    );

    let nodesMatched = 0;
    const nodes = graphOutput.validNodes.map((node) => {
      const stableKey = computeStableKey(spaceId, node.norm_label, node.type);
      if (existingStableKeys.has(stableKey)) {
        nodesMatched += 1;
      }

      return {
        nodeKey: node.id,
        stableKey,
        label: node.label,
        normLabel: node.norm_label,
        type: node.type,
        // Local community_key; persist layer resolves it to a graph_communities PK.
        communityId: assignments.get(node.id) ?? null,
        sourceRefsJson: sourceRefsFor(node.source_file, node.source_location),
      };
    });

    const edges = graphOutput.validEdges.map((edge) => {
      const confidenceLabel: ConfidenceLabel = isConfidenceLabel(edge.confidence)
        ? edge.confidence
        : 'AMBIGUOUS';
      const confidence = mapConfidence(confidenceLabel, edge.confidence_score);

      return {
        sourceNodeKey: edge.source,
        targetNodeKey: edge.target,
        relationType: edge.relation,
        confidenceLabel,
        rawScore: confidence.raw_confidence_score,
        effectiveScore: confidence.effective_confidence_score,
        evidenceCount: 1,
      };
    });

    const aliases = nodes.map((node) => ({ stableKey: node.stableKey, alias: node.nodeKey }));

    return {
      nodes,
      edges,
      communities,
      aliases,
      stats: {
        nodesCreated: nodes.length,
        nodesMatched,
        edgesCreated: edges.length,
        communitiesCreated: communities.length,
        aliasesCreated: aliases.length,
        warnings: [],
        shrinkDetected: false,
      },
    };
  }

  importRun(
    tenantId: string,
    spaceId: string,
    runId: string,
    graphOutput: ValidGraphOutput,
    options: ImportRunOptions = {},
  ): ImportOperation {
    return {
      ...this.prepareImport(
        spaceId,
        graphOutput,
        options.existingStableKeys,
        options.previousNodeCount,
      ),
      tenantId,
      spaceId,
      runId,
    };
  }
}
