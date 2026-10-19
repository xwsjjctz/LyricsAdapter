import { act, renderHook, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';
import type { LyricDocument, PluginProviderInfo, PluginTranslationCall, TranslationResult } from '@/shared/plugin';

const mocks = vi.hoisted(() => ({
  providers: vi.fn(),
  translate: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => ({
    pluginProviders: mocks.providers,
    pluginTranslate: mocks.translate,
    pluginCancel: mocks.cancel,
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
import { applyExternalTranslationPreference } from '@/services/pluginTranslationPreference';

const provider: PluginProviderInfo = {
  key: 'demo:default', pluginId: 'demo', id: 'default', type: 'lyrics.translation', name: 'Demo', version: '1.0.0',
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
