export function getNextVersionNo(existingVersionNos: readonly number[]): number {
  if (existingVersionNos.length === 0) {
    return 1;
  }

  return Math.max(...existingVersionNos) + 1;
}
