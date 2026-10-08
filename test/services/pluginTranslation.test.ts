// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';
const mock = vi.hoisted(() => ({translate:vi.fn(),cancel:vi.fn()}));
vi.mock('@/services/desktopAdapter',()=>({getDesktopAPI:()=>({pluginTranslate:mock.translate,pluginCancel:mock.cancel})}));
import { acquireTranslation, lyricDocumentForTrack } from '@/services/pluginTranslation';
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
