import { net } from 'electron';

function responseHeaders(values: Record<string, string | string[]>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
}

/** GET transport for the updater's explicit redirect loop, using Chromium's proxy settings.
 * net.fetch rejects manual redirects instead of returning their status and Location.
 */
export function fetchPluginUpdate(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    init.signal?.throwIfAborted();
    if ((init.method && init.method !== 'GET') || init.body || init.redirect !== 'manual') {
      throw new Error('Plugin update transport requires a manual-redirect GET');
    }
    const request = net.request({ url, method: 'GET', redirect: 'manual' });
    let finished = false;
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    const cleanup = () => init.signal?.removeEventListener('abort', abort);
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (body) body.error(error);
      reject(error);
    };
    const abort = () => {
      fail(init.signal?.reason ?? new Error('Plugin update request aborted'));
      request.abort();
    };
    request.on('error', fail);
    // ClientRequest is a Writable: its close may fire immediately after end(),
    // before response headers arrive. Only response completion/errors (or the
    // caller's deadline) determine whether the download finished.
    request.on('redirect', (status, _method, location, values) => {
      if (finished) return;
      try {
        const headers = responseHeaders(values);
        headers.set('location', location);
        const response = new Response(null, { status, headers });
        finished = true;
        cleanup();
        resolve(response);
      } catch (error) { fail(error); }
      // The updater validates Location before making a separate request. Never follow here.
      request.abort();
    });
    request.on('response', response => {
      if (finished) return;
      try {
        const headers = responseHeaders(response.headers);
        // Chromium delivers decompressed bytes, as net.fetch does.
        if (headers.has('content-encoding')) {
          headers.delete('content-encoding');
          headers.delete('content-length');
        }
        if ([204, 205, 304].includes(response.statusCode)) {
          finished = true;
          cleanup();
          resolve(new Response(null, { status: response.statusCode, headers }));
          request.abort();
          return;
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            body = controller;
            response.on('end', () => {
              if (finished) return;
              finished = true;
              cleanup();
              controller.close();
            });
            response.on('error', fail);
            // IncomingMessage is a Readable and emits 'close'; Electron's typings omit that overload.
            (response as unknown as NodeJS.EventEmitter).on('close', () => fail(new Error('Plugin update response closed before completion')));
            response.on('aborted', () => fail(new Error('Plugin update response aborted')));
            response.on('data', chunk => { if (!finished) controller.enqueue(chunk); });
          },
          cancel() {
            finished = true;
            cleanup();
            request.abort();
          },
        });
        resolve(new Response(stream, { status: response.statusCode, headers }));
      } catch (error) { fail(error); request.abort(); }
    });
    try {
      new Headers(init.headers).forEach((value, name) => request.setHeader(name, value));
      init.signal?.addEventListener('abort', abort, { once: true });
      if (init.signal?.aborted) abort();
      else request.end();
    } catch (error) { fail(error); request.abort(); }
  });
}
