import { z } from 'zod';

export const indexerPayloadSchema = z
  .object({
    tenant_id: z.string().min(1),
    space_id: z.string().min(1),
    graphify_run_id: z.string().optional(),
    trigger: z.enum(['graphify_completion', 'manual_reindex', 'manual_rebuild', 'feedback_resolved', 'governance_action']),
    scope: z.enum(['full', 'incremental', 'single_page']),
    page_id: z.string().optional(),
  })
  .superRefine((payload, context) => {
    if (payload.scope === 'single_page' && (payload.page_id === undefined || payload.page_id.length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['page_id'],
        message: 'page_id is required for single_page indexing',
      });
    }
  });

export type IndexerPayload = z.infer<typeof indexerPayloadSchema>;
