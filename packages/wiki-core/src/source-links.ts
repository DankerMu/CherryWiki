export interface SourceLink {
  wiki_page_pk: string;
  page_version_id: string;
  section_id?: string | null;
  source_document_id?: string | null;
  source_uri?: string | null;
  quote_hash?: string | null;
  evidence_type: string;
}

export function createSourceLink(link: SourceLink): SourceLink {
  return { ...link, evidence_type: link.evidence_type || 'reference' };
}

export function batchCreateSourceLinks(links: SourceLink[]): SourceLink[] {
  return links.map(createSourceLink);
}
