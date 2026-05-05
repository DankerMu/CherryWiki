export type ConfidenceLabel = string | null | undefined;

export function ConfidenceBadge({ label }: { label: ConfidenceLabel }) {
  const normalized = normalizeConfidenceLabel(label);

  if (normalized === 'INFERRED') {
    return <span className="confidence-badge confidence-inferred">推断</span>;
  }

  if (normalized === 'AMBIGUOUS') {
    return <span className="confidence-badge confidence-ambiguous">待确认</span>;
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
