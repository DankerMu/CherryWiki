import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Public } from '@cherrygraph/auth-core';
import { bridgeWebhookPayloadSchema, ErrorCode, type BridgeEventType, type BridgeWebhookPayload } from '@cherrygraph/shared';
import type { IncomingHttpHeaders } from 'node:http';

import { getApiLogger } from '../common/logger/logger.module.js';
import { BridgeAuthGuard } from './bridge-auth.guard.js';
import { BridgeEventService } from './bridge-event.service.js';
import { BridgeRateLimitGuard } from './bridge-rate-limit.guard.js';

type BridgeEventResponse = {
  accepted: true;
  event_id: string;
  deduplicated: boolean;
};

type RequestLike = {
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  raw?: {
    headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
    ip?: string;
    socket?: {
      remoteAddress?: string;
    };
  };
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
};

@Public()
@UseGuards(BridgeAuthGuard, BridgeRateLimitGuard)
@Controller('internal/docmost/events')
export class BridgeEventController {
  constructor(
    private readonly bridgeEventService: BridgeEventService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('page-saved')
  async receivePageSaved(@Body() body: unknown, @Req() request: RequestLike): Promise<BridgeEventResponse> {
    return this.handleEvent(body, request, 'page.saved');
  }

  @HttpCode(HttpStatus.OK)
  @Post('page-deleted')
  async receivePageDeleted(@Body() body: unknown, @Req() request: RequestLike): Promise<BridgeEventResponse> {
    return this.handleEvent(body, request, 'page.deleted');
  }

  @HttpCode(HttpStatus.OK)
  @Post('attachment-created')
  async receiveAttachmentCreated(@Body() body: unknown, @Req() request: RequestLike): Promise<BridgeEventResponse> {
    return this.handleEvent(body, request, 'attachment.created');
  }

  @HttpCode(HttpStatus.OK)
  @Post('attachment-deleted')
  async receiveAttachmentDeleted(@Body() body: unknown, @Req() request: RequestLike): Promise<BridgeEventResponse> {
    return this.handleEvent(body, request, 'attachment.deleted');
  }

  @HttpCode(HttpStatus.OK)
  @Post('space-updated')
  async receiveSpaceUpdated(@Body() body: unknown, @Req() request: RequestLike): Promise<BridgeEventResponse> {
    return this.handleEvent(body, request, 'space.updated');
  }

  private async handleEvent(
    body: unknown,
    request: RequestLike,
    expectedEventType: BridgeEventType,
  ): Promise<BridgeEventResponse> {
    const startedAt = Date.now();
    const payload = parseBridgePayload(body, expectedEventType);
    const result = await this.bridgeEventService.receiveEvent(payload, {
      nonce: getHeaderValue(request, 'x-bridge-nonce'),
      receivedAt: new Date(startedAt),
    });

    await this.bridgeEventService.recordInboundDelivery(result.bridge_event_id, {
      statusCode: HttpStatus.OK,
      responseTimeMs: Date.now() - startedAt,
    });

    getApiLogger().info({
      action: 'bridge.event_received',
      event_id: result.event_id,
      event_type: result.event_type,
      deduplicated: result.deduplicated,
      ip: getIpAddress(request),
      space_id: payload.space_id,
      page_id: payload.page_id,
    }, 'bridge audit: bridge.event_received');

    return {
      accepted: true,
      event_id: result.event_id,
      deduplicated: result.deduplicated,
    };
  }
}

function parseBridgePayload(body: unknown, expectedEventType: BridgeEventType): BridgeWebhookPayload {
  const result = bridgeWebhookPayloadSchema.safeParse(body);
  if (!result.success) {
    throw new HttpException(
      {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid bridge webhook payload',
        details: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  if (result.data.event_type !== expectedEventType) {
    throw new HttpException(
      {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Bridge event type does not match endpoint',
        details: [
          {
            path: 'event_type',
            expected: expectedEventType,
            received: result.data.event_type,
          },
        ],
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  return result.data;
}

function getHeaderValue(request: RequestLike, name: string): string | undefined {
  const normalizedName = name.toLowerCase();
  const directValue = normalizeHeaderValue(request.headers?.[normalizedName]);
  if (directValue !== undefined) {
    return directValue;
  }

  return normalizeHeaderValue(request.raw?.headers?.[normalizedName]);
}

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return first?.trim();
  }

  return undefined;
}

function getIpAddress(request: RequestLike): string {
  return request.ip || request.raw?.ip || request.raw?.socket?.remoteAddress || request.socket?.remoteAddress || 'unknown';
}
