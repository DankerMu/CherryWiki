import '../../apps/api/node_modules/reflect-metadata/Reflect.js';

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { GraphImportService } from '../../packages/graph-core/src/import-service.js';
import { parseGraphJson } from '../../packages/graph-core/src/parser.js';
import { computeStableKey } from '../../packages/graph-core/src/stable-key.js';
import { validateGraphOutput } from '../../packages/graph-core/src/validator.js';

const GRAPH_FIXTURE = new URL('../fixtures/test-graphify-output/graph.json', import.meta.url);

describe('graph.json import regression integration', () => {
  it('parses, validates, and imports the stable graph fixture deterministically', async () => {
    const raw = await readFile(GRAPH_FIXTURE, 'utf8');
    const parsed = parseGraphJson(raw);
    const validated = validateGraphOutput(parsed);
    const service = new GraphImportService();

    expect(validated).toMatchObject({
      valid: true,
      errors: [],
      warnings: [],
    });

    const first = service.importRun('tenant-1', 'space-1', 'run-1', validated);
    const existingStableKeys = new Set(
      first.nodes.map((node) => computeStableKey('space-1', node.normLabel, node.type)),
    );
    const second = service.importRun('tenant-1', 'space-1', 'run-2', validated, {
      existingStableKeys,
      previousNodeCount: first.nodes.length,
    });

    expect(first.stats).toEqual({
      nodesCreated: 10,
      nodesMatched: 0,
      edgesCreated: 9,
      communitiesCreated: 4,
      aliasesCreated: 10,
      warnings: [],
      shrinkDetected: false,
    });
    expect(second.stats).toEqual({
      ...first.stats,
      nodesMatched: 10,
    });
    expect(second.nodes.map((node) => node.stableKey)).toEqual(first.nodes.map((node) => node.stableKey));
    expect(second.edges).toEqual(first.edges);
  });

  it('rejects malformed graph JSON and trips shrink guard on unstable imports', () => {
    expect(() => parseGraphJson('{bad json')).toThrow('Invalid graph.json: malformed JSON');

    const service = new GraphImportService();
    const tiny = {
      validNodes: [
        {
          id: 'n1',
          label: 'Node 1',
          norm_label: 'node_1',
          type: 'concept',
          community: null,
        },
      ],
      validEdges: [],
    };

    expect(service.prepareImport('space-1', tiny, new Set<string>(), 10).stats).toMatchObject({
      shrinkDetected: true,
      warnings: ['shrink guard: 90% deviation'],
    });
  });
});
