import { formatLabel } from '../../components/adminUi.js';

export const WIKI_PAGE_SIZE = 20;

export function WikiStatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-${getWikiStatusClass(status)}`}>{formatLabel(status)}</span>;
}

export function getWikiStatusClass(status: string): string {
  if (status === 'published') {
    return 'healthy';
  }

  if (status === 'archived') {
    return 'degraded';
  }

  if (status === 'draft') {
    return 'neutral';
  }

  return 'info';
}

export function getFirstItemIndex(page: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return (page - 1) * WIKI_PAGE_SIZE + 1;
}

export function getLastItemIndex(page: number, itemCount: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Math.min(total, getFirstItemIndex(page, total) + itemCount - 1);
}
