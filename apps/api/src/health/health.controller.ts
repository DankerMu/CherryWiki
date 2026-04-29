import { Controller, Get } from '@nestjs/common';
import { APP_VERSION } from '@cherrygraph/shared';
import { readFileSync } from 'node:fs';

export type HealthResponse = {
  status: 'healthy';
  version: string;
  uptime: number;
};

const API_VERSION = readApiPackageVersion();

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'healthy',
      version: API_VERSION,
      uptime: Math.max(1, Math.floor(process.uptime())),
    };
  }
}

function readApiPackageVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as unknown;
    if (isRecord(parsed) && typeof parsed.version === 'string') {
      return parsed.version;
    }
  } catch {
    return APP_VERSION;
  }

  return APP_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
