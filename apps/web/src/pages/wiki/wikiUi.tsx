import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';

export const WIKI_PAGE_SIZE = 20;

function getWikiStatusColor(status: string): string {
  if (status === 'published' || status === 'current') return 'green';
  if (status === 'archived') return 'orange';
  if (status === 'draft') return 'default';
  return 'blue';
}

export function WikiStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const label = t(`wiki.status.${status}`, status.charAt(0).toUpperCase() + status.slice(1));
  return <Tag color={getWikiStatusColor(status)}>{label}</Tag>;
}

export function getWikiStatusClass(status: string): string {
  if (status === 'published') return 'healthy';
  if (status === 'archived') return 'degraded';
  if (status === 'draft') return 'neutral';
  return 'info';
}

export function getFirstItemIndex(page: number, total: number): number {
  if (total === 0) return 0;
  return (page - 1) * WIKI_PAGE_SIZE + 1;
}

export function getLastItemIndex(page: number, itemCount: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(total, getFirstItemIndex(page, total) + itemCount - 1);
}
