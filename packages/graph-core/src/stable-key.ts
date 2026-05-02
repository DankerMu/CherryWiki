import { createHash } from 'node:crypto';

export function computeStableKey(spaceId: string, normLabel: string, nodeType: string): string {
  const input = `${spaceId}:${normLabel}:${nodeType || 'concept'}`;
  return createHash('sha256').update(input).digest('hex').substring(0, 16);
}
