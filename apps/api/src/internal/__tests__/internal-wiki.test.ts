import 'reflect-metadata';

import { HttpException, type ExecutionContext } from '@nestjs/common';
import { ErrorCode } from '@cherrygraph/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DrizzleDatabase } from '../../database/drizzle.module.js';
import {
  ScriptedDb,
  TEST_TENANT_ID,
  getHttpExceptionCode,
  getRejectedHttpException,
} from '../../users/__tests__/user-group-service-test-utils.js';
import { AgentTokenGuard, type AgentAuthenticatedRequest } from '../agent-token.guard.js';
import { InternalWikiController } from '../internal-wiki.controller.js';

const originalAgentToken = process.env.CHERRY_AGENT_TOKEN;
const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

describe('AgentTokenGuard', () => {
  afterEach(() => {
    restoreEnvironment();
    vi.restoreAllMocks();
  });

  it('rejects a missing bearer token with 401', () => {
    process.env.CHERRY_AGENT_TOKEN = 'agent-secret';
    const guard = new AgentTokenGuard();
    const { context } = createGuardContext();

    expect(() => guard.canActivate(context)).toThrowError(HttpException);

    try {
      guard.canActivate(context);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(401);
      expect(getHttpExceptionCode(error)).toBe(ErrorCode.UNAUTHENTICATED);
    }
  });

  it('rejects an invalid bearer token with 401', () => {
    process.env.CHERRY_AGENT_TOKEN = 'agent-secret';
    const guard = new AgentTokenGuard();
    const { context } = createGuardContext('Bearer wrong-secret');

    expect(() => guard.canActivate(context)).toThrowError(HttpException);

    try {
      guard.canActivate(context);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(401);
      expect(getHttpExceptionCode(error)).toBe(ErrorCode.UNAUTHENTICATED);
    }
  });

  it('accepts a valid bearer token and attaches Agent context', () => {
    process.env.CHERRY_AGENT_TOKEN = 'agent-secret';
    const guard = new AgentTokenGuard();
    const { context, request } = createGuardContext('Bearer agent-secret');

    expect(guard.canActivate(context)).toBe(true);
    expect(request.agent).toEqual({
      authenticated: true,
      auth_method: 'static',
    });
  });
});

describe('InternalWikiController', () => {
  afterEach(() => {
    restoreEnvironment();
  });

  it('rejects an empty search query with 400', async () => {
    const { controller } = createControllerContext();

    const error = await getRejectedHttpException(controller.search({ query: '   ' }));

    expect(error.getStatus()).toBe(400);
    expect(getHttpExceptionCode(error)).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('returns search results with the CLI response shape', async () => {
    const { controller, db } = createControllerContext();
    db.queueExecute({
      rows: [
        {
          page_id: 'page-1',
          space_id: 'space-a',
          title: 'Auth Guide',
          section_id: 'overview',
          section_title: 'Overview',
          content: 'Authentication overview content',
          score: '0.72',
        },
      ],
    });

    const result = await controller.search({ query: 'auth', top_k: '5' });

    expect(result).toEqual({
      results: [
        {
          page_id: 'page-1',
          space_id: 'space-a',
          title: 'Auth Guide',
          section_id: 'overview',
          section_title: 'Overview',
          content: 'Authentication overview content',
          score: 0.72,
        },
      ],
    });
    expect(db.executedQueries).toHaveLength(1);
  });

  it('applies requested space_ids to the search query', async () => {
    const { controller, db } = createControllerContext();
    db.queueExecute({
      rows: [
        {
          page_id: 'page-2',
          space_id: 'space-b',
          title: 'Space B Guide',
          section_id: null,
          section_title: null,
          content: 'Space-specific authentication content',
          score: 1,
        },
      ],
    });

    const result = await controller.search({ query: 'auth', space_ids: 'space-b, space-c' });

    expect(result.results).toEqual([
      expect.objectContaining({
        page_id: 'page-2',
        space_id: 'space-b',
      }),
    ]);
    expect(flattenSqlValues(db.executedQueries[0])).toEqual(
      expect.arrayContaining([TEST_TENANT_ID, 'space-b', 'space-c']),
    );
  });

  it('returns 404 when a page is not found', async () => {
    const { controller, db } = createControllerContext();
    db.queueSelect([]);

    const error = await getRejectedHttpException(controller.getPage('missing-page', {}));

    expect(error.getStatus()).toBe(404);
    expect(getHttpExceptionCode(error)).toBe(ErrorCode.WIKI_PAGE_NOT_FOUND);
  });

  it('returns current page content and sections', async () => {
    const { controller, db } = createControllerContext();
    const content = '# Auth Guide\n\nIntro text.\n\n## Overview\nAuthentication overview content.\n';
    const sectionStart = content.indexOf('## Overview');
    db.queueSelect([createPageRow()]);
    db.queueSelect([
      {
        id: 'version-1',
        contentMarkdown: content,
      },
    ]);
    db.queueSelect([
      {
        id: 'section-pk-1',
        sectionId: 'overview',
        heading: 'Overview',
        startOffset: sectionStart,
        endOffset: content.length,
      },
    ]);

    const result = await controller.getPage('page-1', { space_id: 'space-a' });

    expect(result).toEqual({
      page_id: 'page-1',
      space_id: 'space-a',
      title: 'Auth Guide',
      content,
      sections: [
        {
          id: 'section-pk-1',
          section_id: 'overview',
          title: 'Overview',
          content: '## Overview\nAuthentication overview content.\n',
        },
      ],
    });
  });

  it('requires space_id when page_id matches multiple spaces', async () => {
    const { controller, db } = createControllerContext();
    db.queueSelect([
      createPageRow({ spaceId: 'space-a' }),
      createPageRow({ id: 'wiki-page-pk-2', spaceId: 'space-b' }),
    ]);

    const error = await getRejectedHttpException(controller.getPage('page-1', {}));

    expect(error.getStatus()).toBe(400);
    expect(error.message).toBe('space_id required for disambiguation');
  });

  it('returns the selected section content when section matches', async () => {
    const { controller, db } = createControllerContext();
    const content = '# Auth Guide\n\nIntro text.\n\n## Overview\nAuthentication overview content.\n';
    const sectionStart = content.indexOf('## Overview');
    db.queueSelect([createPageRow()]);
    db.queueSelect([{ id: 'version-1', contentMarkdown: content }]);
    db.queueSelect([
      {
        id: 'section-pk-1',
        sectionId: 'overview',
        heading: 'Overview',
        startOffset: sectionStart,
        endOffset: content.length,
      },
    ]);

    const result = await controller.getPage('page-1', { space_id: 'space-a', section: 'overview' });

    expect(result.content).toBe('## Overview\nAuthentication overview content.\n');
    expect(result.sections).toHaveLength(1);
  });
});

function createControllerContext(): { controller: InternalWikiController; db: ScriptedDb } {
  process.env.DEFAULT_TENANT_ID = TEST_TENANT_ID;
  const db = new ScriptedDb();
  return {
    controller: new InternalWikiController(db.asDrizzle() as unknown as DrizzleDatabase),
    db,
  };
}

function createGuardContext(authorization?: string): {
  context: ExecutionContext;
  request: AgentAuthenticatedRequest;
} {
  const request: AgentAuthenticatedRequest = {
    headers: authorization === undefined ? {} : { Authorization: authorization },
  };

  return {
    request,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext,
  };
}

function createPageRow(overrides: Partial<{
  id: string;
  pageId: string;
  spaceId: string;
  title: string;
  currentVersionId: string | null;
}> = {}) {
  return {
    id: 'wiki-page-pk-1',
    pageId: 'page-1',
    spaceId: 'space-a',
    title: 'Auth Guide',
    currentVersionId: 'version-1',
    ...overrides,
  };
}

function flattenSqlValues(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenSqlValues(item));
  }

  if (typeof value !== 'object' || value === null) {
    return [];
  }

  const record = value as { queryChunks?: unknown[]; value?: unknown };
  if (Array.isArray(record.queryChunks)) {
    return flattenSqlValues(record.queryChunks);
  }

  if (record.value !== undefined) {
    return flattenSqlValues(record.value);
  }

  return [];
}

function restoreEnvironment(): void {
  if (originalAgentToken === undefined) {
    delete process.env.CHERRY_AGENT_TOKEN;
  } else {
    process.env.CHERRY_AGENT_TOKEN = originalAgentToken;
  }

  if (originalDefaultTenantId === undefined) {
    delete process.env.DEFAULT_TENANT_ID;
  } else {
    process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
  }
}
