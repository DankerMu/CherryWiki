import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  OpenAIChatProvider,
  type ChatProvider,
  type ChatProviderConfig,
} from '@cherrygraph/ai-core';
import { ErrorCode, model_configs } from '@cherrygraph/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { throwApiError } from '../common/errors/api-error.js';
import { DRIZZLE } from '../database/drizzle.constants.js';
import { CHAT_PROVIDER_FACTORY, type ChatProviderFactory } from './chat.tokens.js';

type ChatDatabase = NodePgDatabase;
export type ChatModelConfigRow = typeof model_configs.$inferSelect;

@Injectable()
export class ChatModelResolutionService {
  private readonly chatProviderFactory: ChatProviderFactory;

  constructor(
    @Inject(DRIZZLE) private readonly db: ChatDatabase,
    @Optional() @Inject(CHAT_PROVIDER_FACTORY) chatProviderFactory?: ChatProviderFactory,
  ) {
    this.chatProviderFactory =
      chatProviderFactory ?? ((config: ChatProviderConfig): ChatProvider => new OpenAIChatProvider(config));
  }

  async resolveEnabledChatModel(tenantId: string): Promise<ChatModelConfigRow> {
    return this.resolveEnabledModel(tenantId, 'chat', ErrorCode.NO_CHAT_MODEL_CONFIGURED);
  }

  createChatProvider(model: ChatModelConfigRow): ChatProvider {
    return this.chatProviderFactory(toChatProviderConfig(model));
  }

  private async resolveEnabledModel(
    tenantId: string,
    modelType: 'chat' | 'embedding',
    missingCode: ErrorCode,
  ): Promise<ChatModelConfigRow> {
    const [model] = await this.db
      .select()
      .from(model_configs)
      .where(
        and(
          eq(model_configs.tenant_id, tenantId),
          eq(model_configs.model_type, modelType),
          eq(model_configs.enabled, true),
        ),
      )
      .orderBy(asc(model_configs.created_at))
      .limit(1);

    if (model === undefined || model.encrypted_api_key_ref === null) {
      throwApiError(
        missingCode,
        modelType === 'chat' ? 'No enabled chat model configured' : 'No enabled embedding model configured',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return model;
  }
}

export function toChatProviderConfig(model: ChatModelConfigRow): ChatProviderConfig {
  if (model.encrypted_api_key_ref === null) {
    throwApiError(
      ErrorCode.NO_CHAT_MODEL_CONFIGURED,
      'No enabled chat model configured',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  return {
    provider: model.provider,
    modelId: model.model_id,
    encryptedApiKeyRef: model.encrypted_api_key_ref,
    ...(model.base_url !== null ? { baseUrl: model.base_url } : {}),
    ...(model.max_tokens !== null ? { maxTokens: model.max_tokens } : {}),
  };
}
