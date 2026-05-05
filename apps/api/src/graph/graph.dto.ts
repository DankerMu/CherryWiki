import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(200);
const optionalSpaceIdSchema = z.preprocess(singleValue, idSchema.optional());
const topKSchema = z.preprocess(singleValue, z.coerce.number().int().min(1).max(100).default(20));
const hopsSchema = z.preprocess(singleValue, z.coerce.number().int().min(1).max(8).default(1));

export const graphNodeSearchQuerySchema = z.object({
  q: z.preprocess(singleValue, z.string().trim().min(1).max(500)),
  space_id: optionalSpaceIdSchema,
  top_k: topKSchema,
});

export const graphPathRequestSchema = z.object({
  source_node_id: idSchema,
  target_node_id: idSchema,
  max_hops: z.coerce.number().int().min(1).max(8).default(4),
});

export const graphNeighborsQuerySchema = z.object({
  hops: hopsSchema,
});

export const graphCommunitiesQuerySchema = z.object({
  space_id: optionalSpaceIdSchema,
});

export const graphNodeResponseSchema = z.object({
  id: z.string(),
  node_key: z.string(),
  stable_key: z.string(),
  label: z.string(),
  node_type: z.string().nullable(),
  description: z.string().nullable().optional(),
  space_id: z.string(),
  community_id: z.string().nullable(),
  score: z.number(),
});

export const graphEdgeResponseSchema = z.object({
  id: z.string(),
  source_node_id: z.string(),
  target_node_id: z.string(),
  relationship: z.string(),
  confidence_label: z.string(),
  effective_confidence_score: z.number().nullable(),
  evidence_count: z.number(),
  space_id: z.string(),
});

export const graphPathResponseSchema = z.object({
  nodes: z.array(graphNodeResponseSchema),
  edges: z.array(graphEdgeResponseSchema),
  total_confidence: z.number(),
});

export const graphSearchResponseSchema = z.object({
  nodes: z.array(graphNodeResponseSchema),
  total: z.number().int().nonnegative(),
});

export const graphPathListResponseSchema = z.object({
  paths: z.array(graphPathResponseSchema),
});

export const graphNeighborResponseSchema = z.object({
  node: graphNodeResponseSchema,
  edge: graphEdgeResponseSchema.nullable(),
  hop: z.number().int().nonnegative(),
});

export const graphNeighborsResponseSchema = z.object({
  center_node: graphNodeResponseSchema.nullable(),
  neighbors: z.array(graphNeighborResponseSchema),
});

export const graphCommunityResponseSchema = z.object({
  id: z.string(),
  community_key: z.string(),
  label: z.string().nullable(),
  summary: z.string().nullable(),
  node_count: z.number().int().nonnegative(),
});

export const graphCommunitiesResponseSchema = z.object({
  communities: z.array(graphCommunityResponseSchema),
});

export type GraphNodeSearchQueryDto = z.infer<typeof graphNodeSearchQuerySchema>;
export type GraphPathRequestDto = z.infer<typeof graphPathRequestSchema>;
export type GraphNeighborsQueryDto = z.infer<typeof graphNeighborsQuerySchema>;
export type GraphCommunitiesQueryDto = z.infer<typeof graphCommunitiesQuerySchema>;
export type GraphNodeResponseDto = z.infer<typeof graphNodeResponseSchema>;
export type GraphEdgeResponseDto = z.infer<typeof graphEdgeResponseSchema>;
export type GraphPathResponseDto = z.infer<typeof graphPathResponseSchema>;
export type GraphSearchResponseDto = z.infer<typeof graphSearchResponseSchema>;
export type GraphPathListResponseDto = z.infer<typeof graphPathListResponseSchema>;
export type GraphNeighborsResponseDto = z.infer<typeof graphNeighborsResponseSchema>;
export type GraphCommunitiesResponseDto = z.infer<typeof graphCommunitiesResponseSchema>;

export function parseGraphNodeSearchQuery(input: unknown): GraphNodeSearchQueryDto {
  return parseDto(graphNodeSearchQuerySchema.safeParse(input));
}

export function parseGraphPathRequest(input: unknown): GraphPathRequestDto {
  return parseDto(graphPathRequestSchema.safeParse(input));
}

export function parseGraphNeighborsQuery(input: unknown): GraphNeighborsQueryDto {
  return parseDto(graphNeighborsQuerySchema.safeParse(input));
}

export function parseGraphCommunitiesQuery(input: unknown): GraphCommunitiesQueryDto {
  return parseDto(graphCommunitiesQuerySchema.safeParse(input));
}

function parseDto<T>(parsed: z.SafeParseReturnType<unknown, T>): T {
  if (parsed.success) {
    return parsed.data;
  }

  throw new HttpException(
    {
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      details: parsed.error.flatten(),
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function singleValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
