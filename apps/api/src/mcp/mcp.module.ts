import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { McpAdminController, McpInvokeController } from './mcp.controller.js';
import { McpRateLimiter } from './mcp-rate-limit.js';
import { McpService } from './mcp.service.js';

@Module({
  imports: [AuditModule],
  controllers: [McpAdminController, McpInvokeController],
  providers: [McpService, McpRateLimiter],
  exports: [McpService, McpRateLimiter],
})
export class McpModule {}
