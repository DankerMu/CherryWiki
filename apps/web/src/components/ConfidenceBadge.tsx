import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';

export type ConfidenceLabel = string | null | undefined;

export function ConfidenceBadge({ label }: { label: ConfidenceLabel }) {
  const { t } = useTranslation();
  const normalized = normalizeConfidenceLabel(label);

  if (normalized === 'INFERRED') {
    return <Tag color="orange">{t('confidence.inferred')}</Tag>;
  }

  if (normalized === 'AMBIGUOUS') {
    return <Tag color="red">{t('confidence.ambiguous')}</Tag>;
  }

  return null;
}

export function normalizeConfidenceLabel(label: ConfidenceLabel): string | null {
  if (typeof label !== 'string' || label.trim().length === 0) {
    return null;
  }

  return label.trim().toUpperCase();
}

export function getConfidenceTone(score: number | null | undefined): 'high' | 'medium' | 'low' {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return 'low';
  }

  if (score > 0.7) {
    return 'high';
  }

  if (score > 0.3) {
    return 'medium';
  }

  return 'low';
}
