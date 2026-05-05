import { Injectable } from '@nestjs/common';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

import { AuditService } from '../audit/audit.service.js';
import type { AgentAuditContext } from './dto/agent.dto.js';

@Injectable()
export class AuditCapture {
  constructor(private readonly auditService: AuditService) {}

  async capture(stream: Readable, context: AgentAuditContext): Promise<void> {
    const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

    for await (const line of lines) {
      const event = parseAuditLine(line);
      if (event === undefined || event.event !== 'database_query') {
        continue;
      }

      this.auditService.push({
        tenant_id: context.tenantId,
        ...(context.userId !== undefined ? { actor_user_id: context.userId } : {}),
        action: 'database_query',
        resource_type: 'sql',
        ...(context.spaceId !== undefined ? { space_id: context.spaceId } : {}),
        metadata_json: {
          ...event,
          ...(context.conversationId !== undefined ? { conversation_id: context.conversationId } : {}),
        },
      });
    }
  }
}

function parseAuditLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
