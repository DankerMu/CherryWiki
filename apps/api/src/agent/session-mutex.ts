export class SessionMutex {
  private readonly locks = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let releaseCurrent = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const chained = previous.then(() => current);

    this.locks.set(key, chained);
    await previous;

    return this.createRelease(key, chained, releaseCurrent);
  }

  tryAcquire(key: string): (() => void) | null {
    if (this.locks.has(key)) {
      return null;
    }

    let releaseCurrent = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    this.locks.set(key, current);
    return this.createRelease(key, current, releaseCurrent);
  }

  isLocked(key: string): boolean {
    return this.locks.has(key);
  }

  private createRelease(key: string, lock: Promise<void>, releaseCurrent: () => void): () => void {
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      releaseCurrent();

      if (this.locks.get(key) === lock) {
        this.locks.delete(key);
      }
    };
  }
}
