import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { nodeReadableToWeb } from '../../../electron/utils/nodeReadableToWeb';

describe('nodeReadableToWeb', () => {
  it('does not eagerly drain an unread Node stream', async () => {
    let reads = 0;
    const source = new Readable({
      highWaterMark: 1,
      read() {
        reads += 1;
        this.push(Buffer.alloc(1));
      },
    });

    const webStream = nodeReadableToWeb(source);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(reads).toBeLessThan(10);
    await webStream.cancel();
  });

  it('destroys the Node stream when the protocol request is aborted', async () => {
    const source = new Readable({ read() {} });
    const controller = new AbortController();
    const webStream = nodeReadableToWeb(source, controller.signal);

    controller.abort();
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(source.destroyed).toBe(true);
    await webStream.cancel().catch(() => {});
  });
});
