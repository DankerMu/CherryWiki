import { Module } from '@nestjs/common';
import { OpenAIChatProvider, OpenAIEmbeddingProvider } from '@cherrygraph/ai-core';

import { AuditModule } from '../audit/audit.module.js';
import { DrizzleModule } from '../database/drizzle.module.js';
import { CHAT_PROVIDER_FACTORY, EMBEDDING_PROVIDER_FACTORY, ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';

@Module({
  imports: [DrizzleModule, AuditModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    {
      provide: CHAT_PROVIDER_FACTORY,
      useValue: (config: ConstructorParameters<typeof OpenAIChatProvider>[0]): OpenAIChatProvider =>
        new OpenAIChatProvider(config),
    },
    {
      provide: EMBEDDING_PROVIDER_FACTORY,
      useValue: (config: ConstructorParameters<typeof OpenAIEmbeddingProvider>[0]): OpenAIEmbeddingProvider =>
        new OpenAIEmbeddingProvider(config),
    },
  ],
  exports: [ChatService],
})
export class ChatModule {}
