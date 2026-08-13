/**
 * Serial, trailing-edge, latest-wins queue for durable snapshots.
 *
 * Writes never overlap. Repeated schedules inside the delay window collapse to
 * the newest value, and drain() waits for both the active write and anything
 * queued while that write was running.
 */
export class LatestWriteQueue<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: T | undefined;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly writer: (value: T) => Promise<void>,
    private readonly delayMs: number,
    private readonly onBackgroundError: (error: unknown) => void = () => {},
  ) {}

  schedule(value: T): void {
    this.pending = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const operation = this.enqueuePending();
      void operation.catch(this.onBackgroundError);
    }, this.delayMs);
  }

  /**
   * Serialize an immediate write after any older delayed snapshot.
   *
   * This is used when two representations share one durable record: an older
   * full snapshot must land before a newer lightweight update, while snapshots
   * scheduled afterwards remain ordered behind both operations.
   */
  enqueue(value: T): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const pending = this.pending;
    this.pending = undefined;
    let operation = this.inFlight.catch(() => {});
    if (pending !== undefined) {
      operation = operation.then(() => this.writer(pending));
    }
    operation = operation.then(() => this.writer(value));
    this.inFlight = operation;
    return operation;
  }

  async drain(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    do {
      const operation = this.enqueuePending();
      await operation;
    } while (this.pending !== undefined);
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = undefined;
  }

  private enqueuePending(): Promise<void> {
    if (this.pending === undefined) return this.inFlight;
    const value = this.pending;
    this.pending = undefined;
    const operation = this.inFlight.catch(() => {}).then(() => this.writer(value));
    this.inFlight = operation;
    return operation;
  }
}
