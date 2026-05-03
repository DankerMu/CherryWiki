## ADDED Requirements

### Requirement: Parse graph.json (Graphify v0.5.3 compatible)
The `packages/graph-core` SHALL export a `parseGraphJson(raw: string)` function that parses Graphify v0.5.3 graph.json format and returns a typed `GraphOutput` structure with `nodes: GraphNode[]`, `edges: GraphEdge[]`, `hyperedges: any[]`.

#### Scenario: Parse minimal valid graph.json
- **WHEN** input contains `{ "nodes": [{ "id": "n1", "label": "Node 1" }], "edges": [], "hyperedges": [] }`
- **THEN** result SHALL contain 1 node with defaults: `type: 'concept'`, `community: null`, `norm_label: 'node 1'` (via normalizeLabel)

#### Scenario: Parse graph.json with all fields
- **WHEN** input contains nodes with id, label, norm_label, type, community, source_file, source_location and edges with source, target, relation, confidence, confidence_score
- **THEN** all fields SHALL be preserved in typed output

#### Scenario: Parse graph.json with missing optional fields
- **WHEN** node lacks `type`, `community`, `norm_label`
- **THEN** defaults SHALL be applied: `type: 'concept'`, `community: null`, `norm_label: normalizeLabel(label)` (NOT just toLowerCase)

### Requirement: Validate graph output
The `packages/graph-core` SHALL export a `validateGraphOutput(parsed: GraphOutput)` function returning `{ valid: boolean, errors: string[], warnings: string[] }`.

#### Scenario: Reject empty nodes array
- **WHEN** graph.json has `nodes: []`
- **THEN** validation SHALL fail with error "graph.json must contain at least one node"

#### Scenario: Reject edge referencing non-existent node
- **WHEN** edge.source is "missing_node" and no node with id "missing_node" exists
- **THEN** validation SHALL return warning "edge references non-existent source node: missing_node" and edge SHALL be excluded from valid output

#### Scenario: Normalize invalid confidence label
- **WHEN** edge.confidence is "UNKNOWN" (not EXTRACTED/INFERRED/AMBIGUOUS)
- **THEN** validation SHALL convert to "AMBIGUOUS" with score 0.2 and add warning

#### Scenario: Validate node label length
- **WHEN** node.label exceeds 256 characters
- **THEN** validation SHALL return error for that node

### Requirement: Compute stable_key (Doc 21 §8A.3)
The `packages/graph-core` SHALL export a `computeStableKey(spaceId: string, normLabel: string, nodeType: string)` function returning the first 16 hex characters of `SHA256("{spaceId}:{normLabel}:{nodeType || 'concept'}")`.

#### Scenario: Consistent stable_key across calls
- **WHEN** called twice with same (spaceId, normLabel, nodeType)
- **THEN** both results SHALL be identical 16-character hex strings

#### Scenario: Different types produce different keys
- **WHEN** called with ("s1", "auth", "module") and ("s1", "auth", "concept")
- **THEN** results SHALL differ

### Requirement: Normalize label for stable_key
The `packages/graph-core` SHALL export a `normalizeLabel(label: string)` function replicating Graphify's normalization: `label.toLowerCase()` then `replace(/[^a-z0-9 ]/g, '').trim()`.

#### Scenario: Normalize mixed-case label with special chars
- **WHEN** input is "Auth/SSO Service v2.0"
- **THEN** result SHALL be "authsso service v20"

### Requirement: Map confidence (Doc 09 §12.2)
The `packages/graph-core` SHALL export a `mapConfidence(label: ConfidenceLabel, rawScore: number)` returning `{ raw_confidence_score: number, effective_confidence_score: number }`.

When rawScore matches the label default (EXTRACTED=1.0, INFERRED=0.5, AMBIGUOUS=0.2), use the initial effective values from Doc 09 §12.2. When rawScore is a non-default continuous value, apply `clamp(rawScore * 0.9, 0.0, 1.0)`.

#### Scenario: EXTRACTED with default score 1.0
- **WHEN** label is "EXTRACTED" and rawScore is 1.0
- **THEN** effective_confidence_score SHALL be 0.90

#### Scenario: INFERRED with default score 0.5
- **WHEN** label is "INFERRED" and rawScore is 0.5
- **THEN** effective_confidence_score SHALL be 0.70

#### Scenario: AMBIGUOUS with default score 0.2
- **WHEN** label is "AMBIGUOUS" and rawScore is 0.2
- **THEN** effective_confidence_score SHALL be 0.40

#### Scenario: Non-default continuous score
- **WHEN** label is "INFERRED" and rawScore is 0.8 (non-default)
- **THEN** effective_confidence_score SHALL be clamp(0.8 * 0.9, 0, 1) = 0.72

### Requirement: Merge communities from nodes
The `packages/graph-core` SHALL export a `mergeCommunities(nodes: GraphNode[])` returning `GraphCommunity[]` by grouping nodes on their `community` field.

#### Scenario: Nodes with same community
- **WHEN** 3 nodes have `community: "auth_system"` and 2 have `community: "ingestion"`
- **THEN** result SHALL contain 2 communities with node_count 3 and 2 respectively

#### Scenario: Nodes with null community
- **WHEN** a node has `community: null`
- **THEN** that node SHALL NOT appear in any community's count

### Requirement: GraphImportService
The `packages/graph-core` SHALL export a `GraphImportService` class with method `importRun(tenantId, spaceId, runId, graphOutput, previousRunId?)` that:
1. Computes stable_key for each node
2. Matches against existing nodes via stable_key or alias lookup
3. Inserts graph_nodes, graph_edges, graph_communities
4. Records new aliases when node_key changes across runs
5. Returns `{ nodesCreated, nodesMatched, edgesCreated, communitiesCreated, aliasesCreated, warnings }`

#### Scenario: First run (no previous data)
- **WHEN** importRun is called with no previousRunId and 10 nodes
- **THEN** 10 nodes SHALL be created, 0 matched, 10 aliases created (self-alias)

#### Scenario: Second run with same nodes
- **WHEN** importRun is called with previousRunId and same 10 labels
- **THEN** 10 nodes SHALL be created (new run), 10 matched via stable_key

#### Scenario: Shrink guard detection (>80% deviation per Doc 12 §6.1)
- **WHEN** previous run had 100 nodes and new run has 15 nodes (deviation 85% > 80%)
- **THEN** importRun SHALL return `{ shrinkDetected: true }` and NOT import data

#### Scenario: Within shrink threshold
- **WHEN** previous run had 100 nodes and new run has 25 nodes (deviation 75% < 80%)
- **THEN** importRun SHALL proceed normally, shrinkDetected=false
