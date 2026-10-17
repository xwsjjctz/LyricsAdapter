// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('electron', () => ({ net: { request: requestMock } }));
import { fetchPluginUpdate } from '../../../electron/services/pluginUpdateFetch';

let request: EventEmitter & { setHeader: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> };
beforeEach(() => {
  request = Object.assign(new EventEmitter(), { setHeader: vi.fn(), end: vi.fn(), abort: vi.fn() });
  requestMock.mockReset().mockReturnValue(request);
});
const url = 'https://github.com/publisher/plugin/releases/download/v1/plugin.laplugin';
const init = { redirect: 'manual' as const };

describe('Chromium plugin update transport', () => {
  it('returns a redirect before Electron cancels it, without following it', async () => {
    const pending = fetchPluginUpdate(url, init);
    request.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/asset', { 'x-test': ['value'] });
    request.emit('error', new Error('Redirect was cancelled'));
    const response = await pending;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://release-assets.githubusercontent.com/asset');
    expect(request.abort).toHaveBeenCalledOnce();
    expect(requestMock).toHaveBeenCalledWith({ url, method: 'GET', redirect: 'manual' });
  });

  it('streams bytes and headers, leaving HTTP errors to the updater', async () => {
    const pending = fetchPluginUpdate(url, { ...init, headers: { Accept: 'application/json' } });
    const incoming = Object.assign(new EventEmitter(), { statusCode: 404, headers: { 'content-type': 'text/plain' } });
    request.emit('response', incoming);
    incoming.emit('data', Buffer.from('missing'));
    incoming.emit('end');
    const response = await pending;
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('missing');
    expect(request.setHeader).toHaveBeenCalledWith('accept', 'application/json');
  });

  it('aborts a pending request with the caller reason', async () => {
    const controller = new AbortController();
    const pending = fetchPluginUpdate(url, { ...init, signal: controller.signal });
    controller.abort(new Error('deadline'));
    await expect(pending).rejects.toThrow('deadline');
    expect(request.abort).toHaveBeenCalledOnce();
  });

  it('propagates an abort while reading the body', async () => {
    const controller = new AbortController();
    const pending = fetchPluginUpdate(url, { ...init, signal: controller.signal });
    request.emit('response', Object.assign(new EventEmitter(), { statusCode: 200, headers: {} }));
    const response = await pending;
    const reading = response.text();
    controller.abort(new Error('deadline'));
    await expect(reading).rejects.toThrow('deadline');
  });

  it('cancels the native request when the updater rejects the response size', async () => {
    const pending = fetchPluginUpdate(url, init);
    request.emit('response', Object.assign(new EventEmitter(), { statusCode: 200, headers: {} }));
    await (await pending).body!.cancel();
    expect(request.abort).toHaveBeenCalledOnce();
  });

  it('fails an incomplete response instead of hanging until the deadline', async () => {
    const pending = fetchPluginUpdate(url, init);
    request.emit('response', Object.assign(new EventEmitter(), { statusCode: 200, headers: {} }));
    const reading = (await pending).text();
    request.emit('close');
    await expect(reading).rejects.toThrow('closed before completion');
  });
});
