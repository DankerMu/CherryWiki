import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { GraphImportService } from '../import-service.js';
import { parseGraphJson } from '../parser.js';
import { validateGraphOutput } from '../validator.js';

describe('graphify output contract', () => {
  it('parses, validates, and prepares import operations for the fixture graph.json', async () => {
    const fixtureUrl = new URL('../../../../tests/fixtures/test-graphify-output/graph.json', import.meta.url);
    const raw = await readFile(fixtureUrl, 'utf8');
    const parsed = parseGraphJson(raw);
    const validation = validateGraphOutput(parsed);
    const operation = new GraphImportService().prepareImport('space-1', validation);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.warnings).toEqual([]);
    expect(validation.validNodes).toHaveLength(10);
    expect(validation.validEdges).toHaveLength(9);
    expect(operation.nodes).toHaveLength(10);
    expect(operation.edges).toHaveLength(9);
    expect(operation.communities).toHaveLength(4);
    expect(operation.stats).toEqual({
      nodesCreated: 10,
      nodesMatched: 0,
      edgesCreated: 9,
      communitiesCreated: 4,
      aliasesCreated: 10,
      warnings: [],
      shrinkDetected: false,
    });
  });
});
