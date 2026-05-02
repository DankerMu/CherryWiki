import { describe, expect, it } from 'vitest';

import { mapConfidence } from '../confidence.js';

describe('mapConfidence', () => {
  it('maps EXTRACTED default score to 0.90 effective confidence', () => {
    expect(mapConfidence('EXTRACTED', 1)).toEqual({
      raw_confidence_score: 1,
      effective_confidence_score: 0.9,
    });
  });

  it('maps INFERRED default score to 0.70 effective confidence', () => {
    expect(mapConfidence('INFERRED', 0.5)).toEqual({
      raw_confidence_score: 0.5,
      effective_confidence_score: 0.7,
    });
  });

  it('maps AMBIGUOUS default score to 0.40 effective confidence', () => {
    expect(mapConfidence('AMBIGUOUS', 0.2)).toEqual({
      raw_confidence_score: 0.2,
      effective_confidence_score: 0.4,
    });
  });

  it('maps non-default continuous scores with clamped raw * 0.9', () => {
    expect(mapConfidence('INFERRED', 0.8)).toEqual({
      raw_confidence_score: 0.8,
      effective_confidence_score: 0.72,
    });
  });

  it('clamps continuous scores to 1', () => {
    expect(mapConfidence('EXTRACTED', 2).effective_confidence_score).toBe(1);
  });
});
