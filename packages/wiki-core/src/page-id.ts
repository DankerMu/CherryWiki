export type WikiPageType = 'community' | 'god_node' | 'generated_article' | 'index';

const typePrefixes: Record<WikiPageType, string> = {
  index: 'index',
  community: 'community',
  god_node: 'god-node',
  generated_article: 'page',
};

export function generatePageId(spaceId: string, pageType: WikiPageType, stableKey: string): string {
  return `${spaceId}.${typePrefixes[pageType]}.${stableKey}`;
}
