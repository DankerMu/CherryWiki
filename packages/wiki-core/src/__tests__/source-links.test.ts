import { describe, expect, it } from 'vitest';

import { batchCreateSourceLinks, createSourceLink } from '../source-links.js';

describe('source link helpers', () => {
  it('creates a source link with all fields', () => {
    const link = {
      wiki_page_pk: 'page-pk-1',
      page_version_id: 'version-1',
      section_id: 'section-1',
      source_document_id: 'doc-1',
      source_uri: 's3://bucket/doc.md',
      quote_hash: 'hash-1',
      evidence_type: 'quote',
    };

    expect(createSourceLink(link)).toEqual(link);
  });

  it('defaults evidence_type to reference', () => {
    expect(
      createSourceLink({
        wiki_page_pk: 'page-pk-1',
        page_version_id: 'version-1',
        evidence_type: '',
      }).evidence_type,
    ).toBe('reference');
  });

  it('processes batches', () => {
    expect(
      batchCreateSourceLinks([
        { wiki_page_pk: 'page-pk-1', page_version_id: 'version-1', evidence_type: 'quote' },
        { wiki_page_pk: 'page-pk-2', page_version_id: 'version-2', evidence_type: '' },
      ]),
    ).toEqual([
      { wiki_page_pk: 'page-pk-1', page_version_id: 'version-1', evidence_type: 'quote' },
      { wiki_page_pk: 'page-pk-2', page_version_id: 'version-2', evidence_type: 'reference' },
    ]);
  });
});
