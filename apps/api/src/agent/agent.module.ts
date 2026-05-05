import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DrizzleModule } from '../database/drizzle.module.js';
import { AgentService } from './agent.service.js';
import { AuditCapture } from './audit-capture.js';
import { ClaudeMdGenerator } from './claude-md-generator.js';
import { SessionManager } from './session-manager.js';
import { SettingsGenerator } from './settings-generator.js';
import { StreamParser } from './stream-parser.js';

@Module({
  imports: [AuditModule, DrizzleModule],
  providers: [
    AgentService,
    SessionManager,
    StreamParser,
    AuditCapture,
    ClaudeMdGenerator,
    SettingsGenerator,
  ],
  exports: [AgentService, SessionManager, StreamParser, AuditCapture, ClaudeMdGenerator, SettingsGenerator],
})
export class AgentModule {}
