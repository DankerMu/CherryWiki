import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';

export class AgentTestDb {
  readonly inserts: Array<{ table?: unknown; value: unknown }> = [];

  insert(table?: unknown): { values: (value: unknown) => Promise<void> } {
    return {
      values: (value: unknown) => {
        this.inserts.push({ table, value });
        return Promise.resolve();
      },
    };
  }
}

export type MockAgentProcess = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals | number) => boolean>>;
  close: (code?: number | null, signal?: NodeJS.Signals | null) => void;
};

export function createMockProcess(): MockAgentProcess {
  const proc = new EventEmitter() as MockAgentProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.exitCode = null;
  proc.kill = vi.fn(() => true);
  proc.close = (code: number | null = 0, signal: NodeJS.Signals | null = null) => {
    proc.exitCode = code;
    proc.stdout.end();
    proc.stderr.end();
    proc.emit('close', code, signal);
    proc.emit('exit', code, signal);
  };

  return proc;
}

export function writeJsonLine(proc: MockAgentProcess, value: Record<string, unknown>): void {
  proc.stdout.write(`${JSON.stringify(value)}\n`);
}

export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const item of iterable) {
    collected.push(item);
  }

  return collected;
}
