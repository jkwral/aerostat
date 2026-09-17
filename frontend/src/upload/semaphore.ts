/** Simple counting semaphore used to cap concurrent uploads (see DECISIONS.md). */
export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(concurrency: number) {
    this.available = concurrency;
  }

  acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.available += 1;
    }
  }
}
