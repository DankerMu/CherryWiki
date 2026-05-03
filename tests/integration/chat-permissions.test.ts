import { PERMISSIONS_METADATA_KEY, RbacGuard } from '@cherrygraph/auth-core';
import { ErrorCode } from '@cherrygraph/shared';
import { describe, expect, it } from 'vitest';

import { ChatController } from '../../apps/api/src/chat/chat.controller.js';
import { getHttpExceptionCode } from '../../apps/api/src/users/__tests__/user-group-service-test-utils.js';
import { Reflector } from '../../packages/auth-core/node_modules/@nestjs/core/index.js';
import {
  TEST_GROUP_ID,
  TEST_SPACE_ID,
  TEST_TENANT_ID,
  TEST_USER_ID,
  collectEvents,
  createGuardContext,
  createRequest,
  createSearchRow,
  createServiceContext,
  executeSqlParams,
  executeSqlText,
  queueActivatedRetrieval,
  queueAssistantMessage,
  queueStreamPrelude,
  ScriptedChatProvider,
} from './chat-integration-test-utils.js';

describe('chat permission isolation integration', () => {
  it('returns 403 when the user lacks chat:use for the requested space', async () => {
    const guard = new RbacGuard(new Reflector(), {
      getPermissionsForUser(input) {
        expect(input.spaceId).toBe(TEST_SPACE_ID);
        return Promise.resolve(['space:view']);
      },
    });
    const request = createRequest({
      body: { space_id: TEST_SPACE_ID, message: 'hello' },
      permissions: ['space:view'],
    });
    const handler = ChatController.prototype.streamCompletion;

    try {
      await guard.canActivate(createGuardContext(handler, request));
    } catch (err) {
      expect((err as { getStatus: () => number }).getStatus()).toBe(403);
      expect(getHttpExceptionCode(err)).toBe(ErrorCode.PERMISSION_DENIED);
      return;
    }

    throw new Error('Expected RBAC guard to reject missing chat:use permission');
  });

  it('keeps retrieval scoped to the requested space and ACL groups', async () => {
    const chatProvider = new ScriptedChatProvider([
      { type: 'content', delta: 'Only the allowed space content is cited [^1].' },
      { type: 'done', finish_reason: 'stop', usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } },
    ]);
    const { service, db } = createServiceContext({ chatProvider });

    queueStreamPrelude(db);
    queueActivatedRetrieval(db, {
      vectorRows: [
        createSearchRow({
          id: 'chunk-space-1',
          content: 'Visible content from space-1.',
          page_title: 'Visible Wiki',
        }),
      ],
    });
    queueAssistantMessage(db);

    const events = await collectEvents(
      await service.streamCompletion({
        tenantId: TEST_TENANT_ID,
        spaceId: TEST_SPACE_ID,
        userId: TEST_USER_ID,
        userGroupIds: [TEST_GROUP_ID],
        message: 'What is visible?',
      }),
    );

    const sqlText = executeSqlText(db);
    const sqlParams = executeSqlParams(db);
    const citationsEvent = events.find((event) => event.type === 'citations');

    expect(Reflect.getMetadata(PERMISSIONS_METADATA_KEY, ChatController.prototype.streamCompletion)).toEqual([
      'chat:use',
    ]);
    expect(citationsEvent).toMatchObject({
      type: 'citations',
      citations: [expect.objectContaining({ chunk_id: 'chunk-space-1' })],
    });
    expect(sqlText).toContain('wc.space_id =');
    expect(sqlText).toContain("wc.acl_json->>'space_id' =");
    expect(sqlText).toContain("wc.acl_json->'allowed_group_ids' ?|");
    expect(sqlParams).toContain(TEST_SPACE_ID);
    expect(sqlParams).toContain(TEST_GROUP_ID);
    expect(sqlParams).not.toContain('space-other');
  });
});
