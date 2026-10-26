// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';
const mock = vi.hoisted(() => ({translate:vi.fn(),cancel:vi.fn(),clear:vi.fn()}));
vi.mock('@/services/desktopAdapter',()=>({getDesktopAPI:()=>({pluginTranslate:mock.translate,pluginCancel:mock.cancel,pluginClearTranslation:mock.clear})}));
import { acquireTranslation, clearTranslation, effectiveTranslationLanguage, languageDisplayName, lyricDocumentForTrack, translationLanguages } from '@/services/pluginTranslation';
const track: Track = {id:'/private/music/example.flac',filePath:'/private/music/example.flac',title:'Title',artist:'Artist',album:'Album',audioUrl:'private-url',duration:100,source:'netease',syncedLyrics:[{time:1,text:'Same'},{time:1,text:'Same'}]};
afterEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();});
describe('lyric translation data boundary and leases',()=>{
 it('uses stable unique IDs and content revisions without exposing local paths or synthesizing title/timing',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const document=await lyricDocumentForTrack(track);
  expect(document.lines.map(l=>l.id)).toEqual(['line-0','line-1']);expect(document.lines[0]?.startMs).toBe(1000);
  expect(JSON.stringify(document)).not.toContain('/private/');expect(document.lines).toHaveLength(2);
  expect(await lyricDocumentForTrack({...track})).toEqual(document);
  expect((await lyricDocumentForTrack({...track,syncedLyrics:[{time:1,text:'changed'}]})).revision).not.toBe(document.revision);
  const untimed=await lyricDocumentForTrack({...track,syncedLyrics:[],lyrics:'One\nTwo'});expect(untimed.lines[0]).not.toHaveProperty('startMs');
 });
 it('shares requests, cancels only the final lease and avoids caching abandoned responses',async()=>{
  vi.stubGlobal('crypto',webcrypto);const document=await lyricDocumentForTrack(track);
  let resolve!: (value:unknown)=>void;mock.translate.mockImplementation(()=>new Promise(r=>{resolve=r}));
  const provider={key:'demo:default',pluginId:'demo',id:'default',type:'lyrics.translation' as const,name:'Demo',version:'1.0.0'};
  const a=acquireTranslation(provider,document,'zh','scope');const b=acquireTranslation(provider,document,'zh','scope');
  await Promise.resolve();expect(mock.translate).toHaveBeenCalledOnce();a.release();expect(mock.cancel).not.toHaveBeenCalled();b.release();expect(mock.cancel).toHaveBeenCalledOnce();
  resolve({documentId:document.id,documentRevision:document.revision,targetLanguage:'zh',lines:[]});await a.promise;
  const c=acquireTranslation(provider,document,'zh','scope');await Promise.resolve();expect(mock.translate).toHaveBeenCalledTimes(2);
  resolve({documentId:document.id,documentRevision:document.revision,targetLanguage:'zh',lines:[]});await c.promise;c.release();
  const cached=acquireTranslation(provider,document,'zh','scope');await cached.promise;cached.release();expect(mock.translate).toHaveBeenCalledTimes(2);
 });
});

describe('provider target languages',()=>{
 const provider={key:'demo:default',pluginId:'demo',id:'default',type:'lyrics.translation' as const,name:'Demo',version:'1.0.0'};
 it('offers the default list until a provider declares its own',()=>{
  expect(translationLanguages(undefined)).toEqual(['zh','en','ja','ko']);
  expect(translationLanguages(provider)).toEqual(['zh','en','ja','ko']);
  expect(translationLanguages({...provider,languages:['fr','de']})).toEqual(['fr','de']);
 });
 it('falls back to a related or the first declared language without changing a supported preference',()=>{
  const declared={...provider,languages:['zh-Hans','zh-Hant','en']};
  expect(effectiveTranslationLanguage(declared,'EN')).toBe('en');
  expect(effectiveTranslationLanguage(declared,'zh-hant')).toBe('zh-Hant');
  expect(effectiveTranslationLanguage(declared,'zh')).toBe('zh-Hans');
  expect(effectiveTranslationLanguage(declared,'ja')).toBe('zh-Hans');
  expect(effectiveTranslationLanguage(null,'ko')).toBe('ko');
 });
 it('names languages in their own script',()=>{
  expect(languageDisplayName('ja')).toBe('日本語');
  expect(languageDisplayName('en')).toBe('English');
 });
});


describe('translation cache control', () => {
 const provider = { key: 'cache-control:default', pluginId: 'cache-control', id: 'default', type: 'lyrics.translation' as const, name: 'Cache control', version: '1.0.0', cacheControl: true };
 const doc = (id: string) => ({ id, trackId: id, revision: 'r1', lines: [{ id: 'line-0', text: 'Hi' }] });
 const reply = (document: ReturnType<typeof doc>, targetLanguage: string, text: string) => ({ documentId: document.id, documentRevision: document.revision, targetLanguage, lines: [{ lineId: 'line-0', text }] });
 it('retains a successful result when a reload fails', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const document = doc('memory-reload-failure');
  mock.translate.mockResolvedValueOnce(reply(document, 'zh', 'old'));
  const original = acquireTranslation(provider, document, 'zh', 'scope');
  await original.promise; original.release();
  mock.translate.mockRejectedValueOnce(new Error('offline'));
  const reload = acquireTranslation(provider, document, 'zh', 'scope', true);
  await expect(reload.promise).rejects.toThrow('offline'); reload.release();
  const kept = acquireTranslation(provider, document, 'zh', 'scope');
  expect((await kept.promise).lines[0]?.text).toBe('old'); kept.release();
  expect(mock.translate).toHaveBeenCalledTimes(2);
 });
 it('clears all revisions/scopes for one song/language without evicting another language', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const document = doc('memory-clear-scopes');
  mock.clear.mockResolvedValue(undefined);
  mock.translate.mockImplementation(async ({ request }: { request: { document: ReturnType<typeof doc>; targetLanguage: string } }) => reply(request.document, request.targetLanguage, 'saved'));
  for (const [language, scope] of [['zh', 'one'], ['zh', 'two'], ['en', 'one']] as const) {
   const lease = acquireTranslation(provider, document, language, scope); await lease.promise; lease.release();
  }
  await clearTranslation(provider, document, 'zh');
  expect(mock.translate).toHaveBeenCalledTimes(3);
  const english = acquireTranslation(provider, document, 'en', 'one'); await english.promise; english.release();
  expect(mock.translate).toHaveBeenCalledTimes(3);
  const chinese = acquireTranslation(provider, document, 'zh', 'one'); await chinese.promise; chinese.release();
  expect(mock.translate).toHaveBeenCalledTimes(4);
 });
 it('waits for a clear to finish before accepting an explicit new generation', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const document = doc('memory-clear-barrier');
  let finish!: () => void;
  mock.clear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const clearing = clearTranslation(provider, document, 'zh');
  await Promise.resolve();
  mock.translate.mockResolvedValueOnce(reply(document, 'zh', 'new'));
  const next = acquireTranslation(provider, document, 'zh', 'scope');
  await Promise.resolve(); expect(mock.translate).not.toHaveBeenCalled();
  finish(); await clearing;
  expect((await next.promise).lines[0]?.text).toBe('new'); next.release();
 });
});
