/** Normalize a raw graphify_run_id: trim whitespace, treat empty as absent. */
export function normalizeGraphifyRunId(runId: string | null | undefined): string | undefined {
  const trimmed = runId?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}
