// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';
import type { PluginTranslationCall, TranslationResult } from '@/shared/plugin';
const mocks = vi.hoisted(() => ({ translate: vi.fn(), clear: vi.fn(), cancel: vi.fn() }));
vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPI: () => ({ pluginTranslate: mocks.translate, pluginClearTranslation: mocks.clear, pluginCancel: mocks.cancel }) }));
import { acquireTranslation, isTranslationRequested, lyricDocumentForTrack, setTranslationRequested, translationRequestKey } from '@/services/pluginTranslation';
import { getTrackTranslationAction, runTrackTranslationAction } from '@/services/trackTranslationActions';

const provider = { key: 'menu:default', pluginId: 'menu', id: 'default', type: 'lyrics.translation' as const, name: 'Menu', version: '1.0.0', cacheControl: true };
const track = (id: string): Track => ({ id, title: id, artist: 'Artist', album: 'Album', duration: 10, audioUrl: '', lyrics: 'Original line' });
const reply = ({ request }: PluginTranslationCall, text = 'Translation'): TranslationResult => ({ documentId: request.document.id, documentRevision: request.document.revision, targetLanguage: request.targetLanguage, lines: [{ lineId: 'line-0', text }] });
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); mocks.translate.mockImplementation(async (call: PluginTranslationCall) => reply(call)); mocks.clear.mockResolvedValue(undefined); });
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe('song menu translation jobs', () => {
  it('generates for the selected song without a mounted Focus view', async () => {
    const selected = track('menu-selected');
    const key = translationRequestKey(selected.id, provider.key, 'zh');
    const task = runTrackTranslationAction(selected, provider, 'zh', 'scope', 'reload');
    expect(getTrackTranslationAction(key).kind).toBe('reload');
    await expect(task).resolves.toBe(true);
    const document = await lyricDocumentForTrack(selected);
    expect(mocks.translate).toHaveBeenCalledWith(expect.objectContaining({ providerKey: provider.key, request: expect.objectContaining({ document, cacheMode: 'reload' }) }));
    expect(getTrackTranslationAction(key).kind).toBeUndefined();
    expect(isTranslationRequested(key)).toBe(true);
  });
  it('keeps the previous memory result when menu retranslation fails', async () => {
    const selected = track('menu-failure');
    const document = await lyricDocumentForTrack(selected);
    const old = acquireTranslation(provider, document, 'zh', 'scope'); await old.promise; old.release();
    mocks.translate.mockRejectedValueOnce(new Error('offline'));
    await expect(runTrackTranslationAction(selected, provider, 'zh', 'scope', 'reload')).rejects.toThrow('offline');
    const kept = acquireTranslation(provider, document, 'zh', 'scope');
    expect((await kept.promise).lines[0]?.text).toBe('Translation'); kept.release();
    expect(mocks.translate).toHaveBeenCalledTimes(2);
  });
  it('clears the remembered request immediately and does not regenerate', async () => {
    const selected = track('menu-clear');
    const key = translationRequestKey(selected.id, provider.key, 'zh');
    setTranslationRequested(key, true);
    const task = runTrackTranslationAction(selected, provider, 'zh', 'scope', 'clear');
    expect(isTranslationRequested(key)).toBe(false);
    expect(getTrackTranslationAction(key).clearRevision).toBe(1);
    await expect(task).resolves.toBe(true);
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.translate).not.toHaveBeenCalled();
  });
  it('supersedes pending reloads with clear and ignores late responses', async () => {
    const selected = track('menu-clear-reload');
    let finish!: () => void;
    mocks.translate.mockImplementationOnce((call: PluginTranslationCall) => new Promise(resolve => { finish = () => resolve(reply(call, 'late')); }));
    const reloading = runTrackTranslationAction(selected, provider, 'zh', 'scope', 'reload');
    await vi.waitFor(() => expect(mocks.translate).toHaveBeenCalledOnce());
    await expect(runTrackTranslationAction(selected, provider, 'zh', 'scope', 'clear')).resolves.toBe(true);
    expect(mocks.cancel).toHaveBeenCalled();
    finish(); await expect(reloading).resolves.toBe(false);
    const key = translationRequestKey(selected.id, provider.key, 'zh');
    expect(isTranslationRequested(key)).toBe(false);
    const document = await lyricDocumentForTrack(selected);
    const explicit = acquireTranslation(provider, document, 'zh', 'scope');
    expect((await explicit.promise).lines[0]?.text).toBe('Translation'); explicit.release();
    expect(mocks.translate).toHaveBeenCalledTimes(2);
  });
  it('shares duplicate jobs and prevents generation while clearing', async () => {
    const selected = track('menu-clearing');
    let finish!: () => void;
    mocks.clear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const task = runTrackTranslationAction(selected, provider, 'zh', 'scope', 'clear');
    expect(runTrackTranslationAction(selected, provider, 'zh', 'scope', 'clear')).toBe(task);
    await expect(runTrackTranslationAction(selected, provider, 'zh', 'scope', 'reload')).rejects.toThrow('being cleared');
    await vi.waitFor(() => expect(mocks.clear).toHaveBeenCalledOnce());
    finish(); await task;
    expect(mocks.translate).not.toHaveBeenCalled();
  });
});
