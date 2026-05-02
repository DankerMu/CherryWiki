import { describe, expect, it } from 'vitest';

import { injectBlockMarkers, parseBlockMarkers } from '../normalization/block-markers.js';

describe('block markers', () => {
  it('injects markers at h2 boundaries', () => {
    const marked = injectBlockMarkers('# Page\n\n## Overview\nText\n\n## Sources\n- doc', 'run-1');

    expect(marked).toContain('<!-- graphify:managed:start id="overview" run="run-1" -->');
    expect(marked).toContain('<!-- graphify:managed:start id="sources" run="run-1" -->');
    expect(marked.match(/graphify:managed:end/g)).toHaveLength(2);
  });

  it('parses graphify and human start markers', () => {
    const markers = parseBlockMarkers(
      '<!-- graphify:managed:start id="overview" run="run-1" -->\n<!-- graphify:human:start id="notes" run="run-2" -->',
    );

    expect(markers).toEqual([
      { blockId: 'overview', owner: 'graphify', runId: 'run-1' },
      { blockId: 'notes', owner: 'human', runId: 'run-2' },
    ]);
  });

  it('round-trips injected block IDs through parse', () => {
    const markers = parseBlockMarkers(injectBlockMarkers('# Page\n\n## Overview\nText\n\n## Sources\n- doc', 'run-1'));

    expect(markers.map(marker => marker.blockId)).toEqual(['overview', 'sources']);
  });
});
