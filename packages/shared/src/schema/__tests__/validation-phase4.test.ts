import { describe, expect, it } from 'vitest';

import {
  apiTokenCreateDto,
  confidenceLabelSchema,
  feedbackCreateDto,
  feedbackResolveDto,
  governanceEdgeReviewDto,
  governanceMergeDto,
  mcpInvokeDto,
  mcpToolCreateDto,
  mcpToolPolicyDto,
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
      }).success,
    ).toBe(false);
  });
});

describe('Phase 4 governance validation', () => {
  it('validates governanceEdgeReviewDto confirm with valid score', () => {
    expect(
      governanceEdgeReviewDto.safeParse({
        action: 'confirm',
        new_score: 0.8,
      }).success,
    ).toBe(true);
  });

  it('rejects governanceEdgeReviewDto confirm without score', () => {
    expect(
      governanceEdgeReviewDto.safeParse({
        action: 'confirm',
      }).success,
    ).toBe(false);
  });

  it('validates governanceEdgeReviewDto reject without score', () => {
    expect(
      governanceEdgeReviewDto.safeParse({
        action: 'reject',
      }).success,
    ).toBe(true);
  });

  it('validates governanceMergeDto and rejects same page', () => {
    expect(
      governanceMergeDto.safeParse({
        from_page_id: 'page-1',
        to_page_id: 'page-2',
      }).success,
    ).toBe(true);
    expect(
      governanceMergeDto.safeParse({
        from_page_id: 'page-1',
        to_page_id: 'page-1',
      }).success,
    ).toBe(false);
  });

  it('accepts REJECTED confidence labels', () => {
    expect(confidenceLabelSchema.safeParse('REJECTED').success).toBe(true);
  });
});
