import { act, renderHook, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';
import type { LyricDocument, PluginProviderInfo, PluginTranslationCall, TranslationResult } from '@/shared/plugin';

const mocks = vi.hoisted(() => ({
  providers: vi.fn(),
  translate: vi.fn(),
  cancel: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => ({
    pluginProviders: mocks.providers,
    pluginTranslate: mocks.translate,
    pluginCancel: mocks.cancel,
    pluginClearTranslation: mocks.clear,
    musicPluginList: async () => [],
  }),
}));
vi.mock('@/services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// A fixed document keeps this test independent of SubtleCrypto under jsdom; the lease,
// cache and request registry are the real ones.
vi.mock('@/services/pluginTranslation', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/pluginTranslation')>(),
  lyricDocumentForTrack: async (track: Track): Promise<LyricDocument> => ({
    id: `lyrics-${track.id}`,
    trackId: track.id,
    revision: 'r1',
    lines: (track.syncedLyrics ?? []).map((line, index) => ({ id: `line-${index}`, text: line.text })),
  }),
}));

import { usePluginTranslation } from '@/hooks/usePluginTranslation';
import { runTrackTranslationAction } from '@/services/trackTranslationActions';
import { musicPluginStore } from '@/stores/musicPluginStore';
import { applyExternalTranslationPreference } from '@/services/pluginTranslationPreference';

const provider: PluginProviderInfo = {
  key: 'demo:default', pluginId: 'demo', id: 'default', type: 'lyrics.translation', name: 'Demo', version: '1.0.0', cacheControl: true,
};
const translated = ({ request }: PluginTranslationCall): TranslationResult => ({
  documentId: request.document.id,
  documentRevision: request.document.revision,
  targetLanguage: request.targetLanguage,
  lines: request.document.lines.map(line => ({ lineId: line.id, text: `译 ${line.text}` })),
});
const translatedLines = { 'line-0': '译 First line', 'line-1': '译 Second line' };
const makeTrack = (id: string): Track => ({
  id,
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  duration: 10,
  audioUrl: 'blob:test',
  syncedLyrics: [{ time: 0, text: 'First line' }, { time: 2, text: 'Second line' }],
});

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  mocks.providers.mockResolvedValue([provider]);
  mocks.clear.mockResolvedValue(undefined);
  mocks.translate.mockImplementation(async (call: PluginTranslationCall) => translated(call));
  applyExternalTranslationPreference({ plugin_lyrics_language: 'zh' }, true);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('usePluginTranslation', () => {
  it('translates only on request and swaps in the finished result', async () => {
    let finish!: () => void;
    mocks.translate.mockImplementation((call: PluginTranslationCall) =>
      new Promise<TranslationResult>(resolve => { finish = () => resolve(translated(call)); }));
    const track = makeTrack('on-request');
    const { result } = renderHook(() => usePluginTranslation(track, true));

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(mocks.translate).not.toHaveBeenCalled();

    act(() => result.current.toggle());
    expect(result.current.status).toBe('translating');
    const waiting = result.current.lines;
    await waitFor(() => expect(mocks.translate).toHaveBeenCalledOnce());
    // The renderers keep the same translations object while the provider works.
    expect(result.current.lines).toBe(waiting);

    await act(async () => finish());
    await waitFor(() => expect(result.current.status).toBe('translated'));
    expect(result.current.lines).toEqual(translatedLines);
  });

  it('remembers the request when Focus Mode reopens and toggles back to the original lines', async () => {
    const track = makeTrack('remembered');
    const first = renderHook(() => usePluginTranslation(track, true));
    await waitFor(() => expect(first.result.current.status).toBe('idle'));
    act(() => first.result.current.toggle());
    await waitFor(() => expect(first.result.current.status).toBe('translated'));
    first.unmount();

    const reopened = renderHook(() => usePluginTranslation(track, true));
    await waitFor(() => expect(reopened.result.current.status).toBe('translated'));
    expect(reopened.result.current.lines).toEqual(translatedLines);

    act(() => reopened.result.current.toggle());
    expect(reopened.result.current.status).toBe('idle');
    expect(reopened.result.current.lines).toEqual({});

    act(() => reopened.result.current.toggle());
    await waitFor(() => expect(reopened.result.current.status).toBe('translated'));
    // Reopening and showing it again were served from the translation cache.
    expect(mocks.translate).toHaveBeenCalledOnce();
  });

  it('offers a retry after a failed translation', async () => {
    mocks.translate.mockRejectedValueOnce(new Error('Model offline'));
    const track = makeTrack('retry');
    const { result } = renderHook(() => usePluginTranslation(track, true));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.lines).toEqual({});

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.status).toBe('translated'));
    expect(mocks.translate).toHaveBeenCalledTimes(2);
  });

  it('offers no control without an enabled translation plugin or without lyrics', async () => {
    const track = makeTrack('unavailable');
    mocks.providers.mockResolvedValue([]);
    const missing = renderHook(() => usePluginTranslation(track, true));
    await waitFor(() => expect(mocks.providers).toHaveBeenCalled());
    await act(async () => {});
    expect(missing.result.current.status).toBe('unavailable');

    mocks.providers.mockResolvedValue([provider]);
    expect(renderHook(() => usePluginTranslation(null, true)).result.current.status).toBe('unavailable');
    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it('uses the enabled translation plugin without a separate choice', async () => {
    const { result } = renderHook(() => usePluginTranslation(makeTrack('enabled'), true));
    await waitFor(() => expect(result.current.status).toBe('idle'));
  });
});


describe('single-song translation actions', () => {
  it('bypasses cached translations and keeps the old lines while reloading and after failure', async () => {
    const track = makeTrack('reload-failure');
    const { result } = renderHook(() => usePluginTranslation(track, true));
    await waitFor(() => expect(result.current.status).toBe('idle'));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.status).toBe('translated'));
    const oldLines = result.current.lines;
    let reject!: (error: Error) => void;
    mocks.translate.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    act(() => result.current.refresh());
    await waitFor(() => expect(mocks.translate).toHaveBeenCalledTimes(2));
    expect(mocks.translate.mock.calls[1]?.[0].request.cacheMode).toBe('reload');
    expect(result.current.status).toBe('translating');
    expect(result.current.lines).toBe(oldLines);
    await act(async () => reject(new Error('offline')));
    await waitFor(() => expect(result.current.actionError).toBe('reload'));
    expect(result.current.status).toBe('translated');
    expect(result.current.lines).toBe(oldLines);
    // Hiding/showing still reads the last successful memory cache.
    act(() => result.current.toggle());
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.status).toBe('translated'));
    expect(mocks.translate).toHaveBeenCalledTimes(2);
  });

  it('replaces the old lines after a successful reload', async () => {
    const track = makeTrack('reload-success');
    const { result } = renderHook(() => usePluginTranslation(track, true));
    await waitFor(() => expect(result.current.status).toBe('idle'));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.status).toBe('translated'));
    mocks.translate.mockImplementationOnce(async (call: PluginTranslationCall) => ({ ...translated(call), lines: [{ lineId: 'line-0', text: '新版译文' }] }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.lines).toEqual({ 'line-0': '新版译文' }));
    expect(result.current.actionError).toBeUndefined();
  });

  it('clears only the current song/language and stays idle when Focus Mode reopens', async () => {
    const track = makeTrack('clear-reopen');
    const first = renderHook(() => usePluginTranslation(track, true));
    await waitFor(() => expect(first.result.current.status).toBe('idle'));
    act(() => first.result.current.toggle());
    await waitFor(() => expect(first.result.current.status).toBe('translated'));
    await act(async () => first.result.current.clear());
    expect(first.result.current.status).toBe('idle');
    expect(first.result.current.lines).toEqual({});
    expect(mocks.clear).toHaveBeenCalledWith(expect.objectContaining({ providerKey: provider.key,
      request: expect.objectContaining({ targetLanguage: 'zh', document: expect.objectContaining({ trackId: track.id }) }) }));
    first.unmount();
    const reopened = renderHook(() => usePluginTranslation(track, true));
    await waitFor(() => expect(reopened.result.current.status).toBe('idle'));
    expect(mocks.translate).toHaveBeenCalledOnce();
    act(() => reopened.result.current.toggle());
    await waitFor(() => expect(reopened.result.current.status).toBe('translated'));
    expect(mocks.translate).toHaveBeenCalledTimes(2);
  });

  it('ignores late results after clearing a pending translation', async () => {
    const track = makeTrack('clear-in-flight');
    let finish!: () => void;
    mocks.translate.mockImplementationOnce((call: PluginTranslationCall) => new Promise(resolve => { finish = () => resolve(translated(call)); }));
    const { result } = renderHook(() => usePluginTranslation(track, true));
    await waitFor(() => expect(result.current.status).toBe('idle'));
    act(() => result.current.toggle());
    await waitFor(() => expect(mocks.translate).toHaveBeenCalledOnce());
    await act(async () => result.current.clear());
    expect(mocks.cancel).toHaveBeenCalled();
    await act(async () => finish());
    expect(result.current.status).toBe('idle');
    expect(result.current.lines).toEqual({});
    expect(mocks.translate).toHaveBeenCalledOnce();
  });

  it('reports a failed clear, blocks generation while clearing and allows an explicit retry', async () => {
    const track = makeTrack('clear-failure');
    let reject!: (error: Error) => void;
    mocks.clear.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const { result } = renderHook(() => usePluginTranslation(track, true));
    await waitFor(() => expect(result.current.status).toBe('idle'));
    let clearing!: Promise<void>;
    act(() => { clearing = result.current.clear(); });
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledOnce());
    expect(result.current.clearing).toBe(true);
    act(() => result.current.toggle());
    expect(mocks.translate).not.toHaveBeenCalled();
    await act(async () => { reject(new Error('disk unavailable')); await clearing; });
    expect(result.current.actionError).toBe('clear');
    expect(result.current.status).toBe('idle');
    await act(async () => result.current.clear());
    expect(result.current.actionError).toBeUndefined();
    expect(mocks.clear).toHaveBeenCalledTimes(2);
    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it('does not apply a delayed clear completion to a different song', async () => {
    let finish!: () => void;
    mocks.clear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const firstTrack = makeTrack('clear-switch-first');
    const secondTrack = makeTrack('clear-switch-second');
    const { result, rerender } = renderHook(({ track }) => usePluginTranslation(track, true), { initialProps: { track: firstTrack } });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    let clearing!: Promise<void>;
    act(() => { clearing = result.current.clear(); });
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledOnce());
    rerender({ track: secondTrack });
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.status).toBe('translated'));
    await act(async () => { finish(); await clearing; });
    expect(result.current.status).toBe('translated');
    expect(result.current.lines).toEqual(translatedLines);
  });
});


describe('external song menu actions with an unchanged Focus page', () => {
  it('updates a mounted lyric view after a menu reload, then clears it without regenerating', async () => {
    const track = makeTrack('external-song-menu');
    const { result } = renderHook(() => usePluginTranslation(track, true));
    await waitFor(() => expect(result.current.status).toBe('idle'));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.status).toBe('translated'));
    mocks.translate.mockImplementationOnce(async (call: PluginTranslationCall) => ({ ...translated(call), lines: [{ lineId: 'line-0', text: 'From the song menu' }] }));
    await act(async () => { await runTrackTranslationAction(track, provider, 'zh', JSON.stringify(musicPluginStore.getSnapshot().plugins), 'reload'); });
    await waitFor(() => expect(result.current.lines).toEqual({ 'line-0': 'From the song menu' }));
    expect(mocks.translate).toHaveBeenCalledTimes(2);
    await act(async () => { await runTrackTranslationAction(track, provider, 'zh', JSON.stringify(musicPluginStore.getSnapshot().plugins), 'clear'); });
    expect(result.current.lines).toEqual({});
    expect(result.current.status).toBe('idle');
    expect(mocks.translate).toHaveBeenCalledTimes(2);
  });
});
