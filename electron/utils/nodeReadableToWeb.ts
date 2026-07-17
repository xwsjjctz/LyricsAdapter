import { Readable } from 'node:stream';

/**
 * Convert a Node readable into the WHATWG stream expected by Electron's
 * protocol handler while preserving backpressure and cancellation.
 *
 * A hand-written `data` listener puts the Node stream into flowing mode and can
 * enqueue an entire audio file before Chromium consumes it. `Readable.toWeb`
 * coordinates the two stream implementations so only a bounded amount is
 * buffered. The protocol request signal is linked as an additional safeguard
 * for track switches and window teardown.
 */
export function nodeReadableToWeb(
  stream: Readable,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  if (signal) {
    const abort = () => {
      if (!stream.destroyed) stream.destroy();
    };
    const removeAbortListener = () => signal.removeEventListener('abort', abort);

    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener('abort', abort, { once: true });
      stream.once('close', removeAbortListener);
    }
  }

  // This is a real runtime conversion. The cast only bridges Node's and the
  // DOM library's structurally equivalent ReadableStream type declarations.
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}
