import type { ConfidenceLabel, ConfidenceMapping } from './types.js';

const DEFAULTS: Record<ConfidenceLabel, { raw: number; effective: number }> = {
  EXTRACTED: { raw: 1.0, effective: 0.9 },
  INFERRED: { raw: 0.5, effective: 0.7 },
  AMBIGUOUS: { raw: 0.2, effective: 0.4 },
};

function clamp(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function toStableScore(value: number): number {
  return Number(value.toFixed(12));
}

export function mapConfidence(label: ConfidenceLabel, rawScore: number): ConfidenceMapping {
  const defaults = DEFAULTS[label];
  if (rawScore === defaults.raw) {
    return {
      raw_confidence_score: rawScore,
      effective_confidence_score: defaults.effective,
    };
  }

  const normalizedRawScore = Number.isFinite(rawScore) ? rawScore : 0;
  return {
    raw_confidence_score: rawScore,
    effective_confidence_score: toStableScore(clamp(normalizedRawScore * 0.9)),
  };
}
