import { describe, expect, it } from 'vitest';

import { WikiFromGraphService } from '../wiki-from-graph.service.js';
import { FakeGraphPipelineDb } from './fake-graph-pipeline-db.js';

describe('WikiFromGraphService', () => {
  it('creates a published wiki page + version per community and links member nodes', async () => {
    const db = new FakeGraphPipelineDb();
    db.communities.push({
      id: 'community-1',
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      graphify_run_id: 'run-1',
      community_key: 'c1',
      label: 'Auth Flow',
      summary: 'How auth works',
    });
    db.nodes.push(
      {
        id: 'node-b',
        tenant_id: 'tenant-1',
        space_id: 'space-1',
        graphify_run_id: 'run-1',
        community_id: 'community-1',
        label: 'Beta',
        type: 'concept',
        source_refs_json: [{ file: 'beta.md' }, { file: 'beta.md' }],
        wiki_page_pk: null,
      },
      {
        id: 'node-a',
        tenant_id: 'tenant-1',
        space_id: 'space-1',
        graphify_run_id: 'run-1',
        community_id: 'community-1',
        label: 'Alpha',
        type: 'service',
        source_refs_json: [{ file: 'alpha.md' }],
        wiki_page_pk: null,
      },
    );
    db.edges.push({
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      graphify_run_id: 'run-1',
      source_node_id: 'node-a',
      target_node_id: 'node-b',
      relation_type: 'calls',
      confidence_label: 'HIGH',
    });

    const service = new WikiFromGraphService(db.asDb() as never);
    const generated = await service.generateForRun('tenant-1', 'space-1', 'run-1', 'user-1');

    expect(generated).toBe(1);
    expect(db.pages).toHaveLength(1);
    const page = db.pages[0]!;
    expect(page.page_id).toBe('graph-community-c1');
    expect(page.slug).toBe('graph-community-c1');
    expect(page.status).toBe('published');
    expect(page.current_version_id).toBe(db.versions[0]!.id);

    expect(db.versions).toHaveLength(1);
    const version = db.versions[0]!;
    expect(version.status).toBe('published');
    expect(version.source).toBe('graphify');
    expect(version.graphify_run_id).toBe('run-1');
    expect(version.version_no).toBe(1);
    expect(version.created_by).toBe('user-1');

    // Stable ordering: Alpha before Beta; sources deduped; relationships rendered.
    const markdown = String(version.content_markdown);
    expect(markdown).toContain('# Auth Flow');
    expect(markdown).toContain('How auth works');
    const alphaIdx = markdown.indexOf('**Alpha**');
    const betaIdx = markdown.indexOf('**Beta**');
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(alphaIdx).toBeLessThan(betaIdx);
    expect(markdown).toContain('- **Beta** (concept) — sources: beta.md');
    expect(markdown).toContain('- Alpha —calls→ Beta (HIGH)');

    // Member nodes were linked to the new page PK.
    for (const node of db.nodes) {
      expect(node.wiki_page_pk).toBe(page.id);
    }
  });

  it('falls back to a Community label when the community has no label', async () => {
    const db = new FakeGraphPipelineDb();
    db.communities.push({
      id: 'community-9',
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      graphify_run_id: 'run-1',
      community_key: 'c9',
      label: null,
      summary: null,
    });

    const service = new WikiFromGraphService(db.asDb() as never);
    await service.generateForRun('tenant-1', 'space-1', 'run-1', null);

    expect(db.pages[0]!.title).toBe('Community c9');
    expect(db.versions[0]!.content_markdown).toContain('# Community c9');
    expect(db.versions[0]!.content_markdown).toContain('_No members._');
    expect(db.versions[0]!.content_markdown).toContain('_No relationships._');
  });

  it('is idempotent: a second run appends version_no 2 and repoints current_version_id', async () => {
    const db = new FakeGraphPipelineDb();
    db.communities.push({
      id: 'community-1',
      tenant_id: 'tenant-1',
      space_id: 'space-1',
      graphify_run_id: 'run-1',
      community_key: 'c1',
      label: 'Auth Flow',
      summary: null,
    });

    const service = new WikiFromGraphService(db.asDb() as never);
    await service.generateForRun('tenant-1', 'space-1', 'run-1', 'user-1');

    // Re-run for the same community_key (new run id, same key/space).
    db.communities[0]!.graphify_run_id = 'run-2';
    await service.generateForRun('tenant-1', 'space-1', 'run-2', 'user-1');

    // Exactly one page, two versions; current points at the latest.
    expect(db.pages).toHaveLength(1);
    expect(db.versions).toHaveLength(2);
    const versionNos = db.versions.map((version) => version.version_no).sort();
    expect(versionNos).toEqual([1, 2]);
    const latest = db.versions.find((version) => version.version_no === 2)!;
    expect(db.pages[0]!.current_version_id).toBe(latest.id);
    expect(latest.graphify_run_id).toBe('run-2');
  });
});
