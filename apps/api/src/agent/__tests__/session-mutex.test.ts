import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { SessionMutex } from '../session-mutex.js';

void vi;

describe('SessionMutex', () => {
  it('acquires an unlocked key immediately', async () => {
    const mutex = new SessionMutex();

    const release = await mutex.acquire('conversation-1');

    expect(mutex.isLocked('conversation-1')).toBe(true);
    release();
    expect(mutex.isLocked('conversation-1')).toBe(false);
  });

  it('waits for release when acquiring a locked key', async () => {
    const mutex = new SessionMutex();
    const releaseFirst = await mutex.acquire('conversation-1');
    const acquired: string[] = [];
    const secondAcquire = mutex.acquire('conversation-1').then((release) => {
      acquired.push('second');
      return release;
    });

    await Promise.resolve();
    expect(acquired).toEqual([]);

    releaseFirst();
    const releaseSecond = await secondAcquire;

    expect(acquired).toEqual(['second']);
    releaseSecond();
  });

  it('tryAcquire returns a release function for an unlocked key', () => {
    const mutex = new SessionMutex();

    const release = mutex.tryAcquire('conversation-1');

    expect(release).toEqual(expect.any(Function));
    expect(mutex.isLocked('conversation-1')).toBe(true);
    release?.();
    expect(mutex.isLocked('conversation-1')).toBe(false);
  });

  it('tryAcquire returns null for a locked key', async () => {
    const mutex = new SessionMutex();
    const release = await mutex.acquire('conversation-1');

    expect(mutex.tryAcquire('conversation-1')).toBeNull();

    release();
  });

  it('reflects lock state with isLocked', async () => {
    const mutex = new SessionMutex();

    expect(mutex.isLocked('conversation-1')).toBe(false);
    const release = await mutex.acquire('conversation-1');
    expect(mutex.isLocked('conversation-1')).toBe(true);
    release();
    expect(mutex.isLocked('conversation-1')).toBe(false);
  });

  it('supports two sequential acquire and release cycles', async () => {
    const mutex = new SessionMutex();

    const releaseFirst = await mutex.acquire('conversation-1');
    releaseFirst();

    const releaseSecond = await mutex.acquire('conversation-1');
    expect(mutex.isLocked('conversation-1')).toBe(true);
    releaseSecond();

    expect(mutex.isLocked('conversation-1')).toBe(false);
  });

  it('uses idempotent release functions', async () => {
    const mutex = new SessionMutex();
    const release = await mutex.acquire('conversation-1');

    release();
    expect(() => release()).not.toThrow();

    expect(mutex.isLocked('conversation-1')).toBe(false);
  });
});
