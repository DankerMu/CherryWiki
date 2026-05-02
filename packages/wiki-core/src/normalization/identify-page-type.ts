import type { WikiPageType } from '../page-id.js';
import { safeFilename } from './safe-filename.js';

export function identifyPageType(
  filename: string,
  communityLabels: string[],
  godNodeLabels: string[],
): WikiPageType {
  const name = filename.replace(/\.md$/i, '');
  if (name === 'index') {
    return 'index';
  }

  const communityFilenames = new Set(communityLabels.flatMap(labelVariants));
  if (communityFilenames.has(name) || communityFilenames.has(normalizeForComparison(name))) {
    return 'community';
  }

  const godNodeFilenames = new Set(godNodeLabels.flatMap(labelVariants));
  if (godNodeFilenames.has(name) || godNodeFilenames.has(normalizeForComparison(name))) {
    return 'god_node';
  }

  return 'generated_article';
}

function labelVariants(label: string): string[] {
  const safe = safeFilename(label);

  return [safe, normalizeForComparison(safe)];
}

function normalizeForComparison(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, '-');
}
