import { describe, expect, it } from 'vitest';

import {
  apiTokenCreateDto,
  confidenceLabelSchema,
  conflictItemDto,
  feedbackCreateDto,
  feedbackResolveDto,
  governanceEdgeReviewDto,
  governanceMergeDto,
  mcpInvokeDto,
  mcpToolCreateDto,
  mcpToolPolicyDto,
  wikiPageStatusSchema,
} from '../validation.js';

describe('Phase 4 feedback validation', () => {
  it('validates feedbackCreateDto with message_id', () => {
    const parsed = feedbackCreateDto.parse({
      feedback_type: 'incorrect',
      message_id: 'message-1',
    });

    expect(parsed.payload_json).toEqual({});
  });

  it('validates feedbackCreateDto with payload_json.page_id', () => {
    expect(
      feedbackCreateDto.safeParse({
        feedback_type: 'missing',
        payload_json: { page_id: 'page-1' },
      }).success,
    ).toBe(true);
  });

  it('rejects feedbackCreateDto without message_id or payload_json.page_id', () => {
    expect(
      feedbackCreateDto.safeParse({
        feedback_type: 'outdated',
      }).success,
    ).toBe(false);
  });

  it('rejects feedbackCreateDto with whitespace-only targets', () => {
    expect(
      feedbackCreateDto.safeParse({
        feedback_type: 'incorrect',
        message_id: '   ',
        payload_json: { page_id: '  ' },
      }).success,
    ).toBe(false);
  });

  it('rejects feedbackCreateDto invalid feedback_type values', () => {
    expect(
      feedbackCreateDto.safeParse({
        feedback_type: 'citation_error',
        message_id: 'message-1',
      }).success,
    ).toBe(false);
    expect(
      feedbackCreateDto.safeParse({
        feedback_type: 'conflict',
        message_id: 'message-1',
      }).success,
    ).toBe(false);
  });

  it('validates feedbackResolveDto resolution and notes', () => {
    expect(
      feedbackResolveDto.safeParse({
        resolution: 'accepted',
        notes: 'Page updated',
      }).success,
    ).toBe(true);
  });

  it('rejects invalid feedbackResolveDto resolution', () => {
    expect(
      feedbackResolveDto.safeParse({
        resolution: 'closed',
      }).success,
    ).toBe(false);
  });
});

describe('Phase 4 API token validation', () => {
  it('validates apiTokenCreateDto', () => {
    expect(
      apiTokenCreateDto.safeParse({
        name: 'Automation token',
        scopes: ['mcp:invoke'],
        expires_in_days: 30,
      }).success,
    ).toBe(true);
  });

  it('rejects empty apiTokenCreateDto name', () => {
    expect(
      apiTokenCreateDto.safeParse({
        name: '   ',
        scopes: ['mcp:invoke'],
      }).success,
    ).toBe(false);
  });

  it('rejects empty apiTokenCreateDto scopes', () => {
    expect(
      apiTokenCreateDto.safeParse({
        name: 'Automation token',
        scopes: [],
      }).success,
    ).toBe(false);
  });
});

describe('Phase 4 MCP validation', () => {
  it('validates mcpToolCreateDto', () => {
    const parsed = mcpToolCreateDto.parse({
      tool_name: 'search-docs',
      server_url: 'https://mcp.example.com/sse',
    });

    expect(parsed.transport).toBe('sse');
    expect(parsed.input_schema).toEqual({});
    expect(parsed.scopes).toEqual([]);
  });

  it('rejects mcpToolCreateDto invalid URL', () => {
    expect(
      mcpToolCreateDto.safeParse({
        tool_name: 'search-docs',
        server_url: 'not-a-url',
      }).success,
    ).toBe(false);
  });

  it('applies mcpToolPolicyDto defaults', () => {
    expect(mcpToolPolicyDto.parse({})).toEqual({
      allowed_roles: [],
      allowed_spaces: [],
      allowed_scopes: [],
      rate_limit_rpm: 60,
    });
  });

  it('validates mcpToolPolicyDto with all fields', () => {
    expect(
      mcpToolPolicyDto.safeParse({
        allowed_roles: ['admin'],
        allowed_spaces: ['space-1'],
        allowed_scopes: ['mcp:invoke'],
        rate_limit_rpm: 120,
      }).success,
    ).toBe(true);
  });

  it('validates mcpInvokeDto', () => {
    expect(
      mcpInvokeDto.safeParse({
        tool_name: 'search-docs',
        arguments: { query: 'SSO' },
        space_id: 'space-1',
      }).success,
    ).toBe(true);
  });

  it('rejects empty mcpInvokeDto tool_name', () => {
    expect(
      mcpInvokeDto.safeParse({
        tool_name: '   ',
        space_id: 'space-1',
      }).success,
    ).toBe(false);
  });

  it('rejects mcpInvokeDto without space_id', () => {
    expect(
      mcpInvokeDto.safeParse({
        tool_name: 'search-docs',
      }).success,
    ).toBe(false);
  });
});

describe('Phase 4 governance validation', () => {
  it('validates governanceEdgeReviewDto confirm with valid score and reason', () => {
    expect(
      governanceEdgeReviewDto.safeParse({
        action: 'confirm',
        effective_score: 0.8,
        reason: 'Manual verification',
      }).success,
    ).toBe(true);
  });

  it('rejects governanceEdgeReviewDto confirm without score', () => {
    expect(
      governanceEdgeReviewDto.safeParse({
        action: 'confirm',
        reason: 'Manual verification',
      }).success,
    ).toBe(false);
  });

  it('rejects governanceEdgeReviewDto without reason', () => {
    expect(
      governanceEdgeReviewDto.safeParse({
        action: 'reject',
      }).success,
    ).toBe(false);
  });

  it('validates governanceEdgeReviewDto reject with reason but no score', () => {
    expect(
      governanceEdgeReviewDto.safeParse({
        action: 'reject',
        reason: 'Hallucinated relationship',
      }).success,
    ).toBe(true);
  });

  it('validates governanceMergeDto with reason and rejects same page', () => {
    expect(
      governanceMergeDto.safeParse({
        from_page_id: 'page-1',
        to_page_id: 'page-2',
        reason: 'Duplicate content',
      }).success,
    ).toBe(true);
    expect(
      governanceMergeDto.safeParse({
        from_page_id: 'page-1',
        to_page_id: 'page-1',
        reason: 'Duplicate content',
      }).success,
    ).toBe(false);
  });

  it('rejects governanceMergeDto without reason', () => {
    expect(
      governanceMergeDto.safeParse({
        from_page_id: 'page-1',
        to_page_id: 'page-2',
      }).success,
    ).toBe(false);
  });

  it('validates governanceEdgeReviewDto confirm at boundary score 0.55', () => {
    expect(
      governanceEdgeReviewDto.safeParse({
        action: 'confirm',
        effective_score: 0.55,
        reason: 'Borderline but valid',
      }).success,
    ).toBe(true);
  });

  it('rejects governanceEdgeReviewDto confirm with score below 0.55', () => {
    expect(
      governanceEdgeReviewDto.safeParse({
        action: 'confirm',
        effective_score: 0.54,
        reason: 'Too low',
      }).success,
    ).toBe(false);
  });

  it('accepts REJECTED confidence labels', () => {
    expect(confidenceLabelSchema.safeParse('REJECTED').success).toBe(true);
  });

  it('accepts merged wiki page status for governance merges', () => {
    expect(wikiPageStatusSchema.safeParse('merged').success).toBe(true);
  });
});

describe('Phase 4 conflict validation', () => {
  it('validates conflictItemDto with required fields', () => {
    expect(
      conflictItemDto.safeParse({
        conflict_type: 'contradictory_edges',
        entity_pair: {
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          source_label: 'React',
          target_label: 'Vue',
        },
        conflicting_items: [{ edge_id: 'e1' }, { edge_id: 'e2' }],
        severity: 'high',
      }).success,
    ).toBe(true);
  });

  it('rejects conflictItemDto with fewer than 2 conflicting items', () => {
    expect(
      conflictItemDto.safeParse({
        conflict_type: 'edge_chunk_mismatch',
        entity_pair: {
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          source_label: 'React',
          target_label: 'Vue',
        },
        conflicting_items: [{ edge_id: 'e1' }],
        severity: 'medium',
      }).success,
    ).toBe(false);
  });

  it('rejects conflictItemDto with invalid severity', () => {
    expect(
      conflictItemDto.safeParse({
        conflict_type: 'contradictory_edges',
        entity_pair: {
          source_node_id: 'node-1',
          target_node_id: 'node-2',
          source_label: 'A',
          target_label: 'B',
        },
        conflicting_items: [{ edge_id: 'e1' }, { edge_id: 'e2' }],
        severity: 'critical',
      }).success,
    ).toBe(false);
  });

  it('rejects conflictItemDto missing entity_pair labels', () => {
    expect(
      conflictItemDto.safeParse({
        conflict_type: 'contradictory_edges',
        entity_pair: {
          source_node_id: 'node-1',
          target_node_id: 'node-2',
        },
        conflicting_items: [{ edge_id: 'e1' }, { edge_id: 'e2' }],
        severity: 'low',
      }).success,
    ).toBe(false);
  });
});
