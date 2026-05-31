import { Module } from '@nestjs/common';
import { OpenAIChatProvider, OpenAIEmbeddingProvider } from '@cherrygraph/ai-core';

import { AgentModule } from '../agent/agent.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { DrizzleModule } from '../database/drizzle.module.js';
import { GraphModule } from '../graph/graph.module.js';
import { ModelConfigModule } from '../models/model-config.module.js';
import { CHAT_PROVIDER_FACTORY, EMBEDDING_PROVIDER_FACTORY, ChatService } from './chat.service.js';
import { ChatRetrievalService } from './chat-retrieval.service.js';
import { ChatSessionBoundaryService } from './chat-session-boundary.service.js';
import { ChatController } from './chat.controller.js';

@Module({
  imports: [DrizzleModule, AuditModule, AgentModule, GraphModule, ModelConfigModule],
  controllers: [ChatController],
  providers: [
    ChatSessionBoundaryService,
    ChatRetrievalService,
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
