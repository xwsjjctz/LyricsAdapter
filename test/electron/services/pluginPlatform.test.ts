// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicPluginRegistry } from '../../../electron/services/musicPluginRegistry';
import { supportsApi } from '../../../electron/services/pluginManifest';
import { withDeadline, PluginRuntime } from '../../../electron/services/pluginRuntime';
import type { PluginManifest, TranslationRequest } from '../../../src/shared/plugin';
import { validateTranslationResult } from '../../../src/shared/pluginValidation';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); vi.useRealTimers(); vi.unstubAllGlobals(); });
const manifest: PluginManifest = { manifestVersion: 1, id: 'translator', name: 'Translator', version: '1.0.0', main: 'index.cjs', coreApi: '^1.0.0',
 extensionApis: { 'lyrics.translation': '^1.0.0' }, permissions: { network: ['https://translate.example'], secrets: 'own' },
 contributes: { providers: [{ type: 'lyrics.translation', id: 'default', name: 'Translation' }], configuration: { prefix: { title: 'Prefix', type: 'string', default: 'one' } } } };
const request: TranslationRequest = { document: { id: 'doc', revision: 'revision-1', trackId: 'opaque', lines: [{ id: 'line-0', text: 'Same', startMs: 1000 }, { id: 'line-1', text: 'Same', startMs: 1000 }] }, targetLanguage: 'zh' };
const code = `exports.activate = context => {
 context.logger.info('activate', context.apiVersions);
 context.storage.set('count', (context.storage.get('count') || 0) + 1);
 context.subscriptions.push({ dispose: () => context.logger.info('dispose') });
 context.configuration.onDidChange(() => context.logger.info('configuration'));
 context.extensions.register('lyrics.translation', 'default', { translate: async ({document,targetLanguage}, {signal}) => {
  signal.throwIfAborted();
  return {documentId:document.id,documentRevision:document.revision,targetLanguage,lines:document.lines.map(l => ({lineId:l.id,text:context.configuration.get('prefix')+l.text}))};
 } });
}; exports.deactivate = () => {};`;
function fixture(source = code, selected = manifest) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-platform-')); roots.push(root);
 const directory = path.join(root, 'installed', selected.id); fs.mkdirSync(directory, { recursive: true });
 fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(selected)); fs.writeFileSync(path.join(directory, selected.main), source);
 const data = new Map<string,string>(); const enabled = new Map<string,boolean>();
 const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
 const host = { logger, readSecret: (key:string) => data.get(`secret:${key}`) ?? '', writeSecrets: (entries:Record<string,string>) => Object.entries(entries).forEach(([k,v]) => data.set(`secret:${k}`,v)),
 readSetting: (key:string) => data.get(key), writeSetting: (key:string,value:string|undefined) => { if(value===undefined)data.delete(key); else data.set(key,value); } };
 const options = { installedDirectory: path.join(root, 'installed'), host: () => host, isEnabled: (id:string) => enabled.get(id) !== false, setEnabled:(id:string,value:boolean) => {enabled.set(id,value);} };
 const registry = new MusicPluginRegistry(options);
 return { root, directory, registry, options, logger, host, data };
}
const translate = (registry:MusicPluginRegistry, signal = new AbortController().signal) => registry.translate('translator:default', request, signal, 'request-1');
describe('public plugin API negotiation and compatibility', () => {
 it.each([
  ['1.2.0','^1.0.0',true], ['2.0.0','^1.0.0',false], ['1.0.0','^1.1.0',false], ['1.2.9','~1.2.0',true], ['1.3.0','~1.2.0',false],
  ['0.2.4','^0.2.1',true], ['0.3.0','^0.2.1',false], ['0.0.2','^0.0.1',false], ['0.0.2','~0.0.1',true], ['1.0.0','1.0.0',true], ['1.1.0','1.0.0',false], ['1.0.0','*',false],
 ])('negotiates %s against %s', (version,range,result) => expect(supportsApi(version,range)).toBe(result));
 it('rejects required incompatible APIs before executing code', () => {
  for (const selected of [{...manifest,coreApi:'^2.0.0'}, {...manifest,extensionApis:{'lyrics.translation':'^2.0.0'}}]) {
   const {registry,logger} = fixture("throw new Error('executed')",selected);
   expect(registry.list()[0]?.error).toContain('Unsupported'); expect(logger.info).not.toHaveBeenCalled();
  }
 });
 it('skips unknown optional capabilities and exposes only negotiated versions', async () => {
  const selected = {...manifest,optionalExtensionApis:{'future.extension':'^3.0.0'}, contributes:{...manifest.contributes,providers:[...manifest.contributes.providers,{type:'future.extension',id:'future',name:'Future'}]}};
  const {registry,logger} = fixture(code,selected);
  expect(registry.providers('lyrics.translation')).toHaveLength(1);
  await translate(registry);
  expect(logger.info).toHaveBeenCalledWith('activate',expect.objectContaining({coreApi:'1.1.0',extensionApis:{'lyrics.translation':'1.2.0'}}));
 });
 it('lazily activates once, cleans up on disable, reactivates with preserved private data and respects config validation', async () => {
  const {registry,logger,data,options} = fixture();
  expect(logger.info).not.toHaveBeenCalled();
  expect(await translate(registry)).toMatchObject({lines:[{lineId:'line-0',text:'oneSame'},{lineId:'line-1',text:'oneSame'}]});
  await translate(registry); expect(logger.info.mock.calls.filter(([kind]) => kind==='activate')).toHaveLength(1);
  registry.setConfiguration('translator','prefix','two'); expect(logger.info).toHaveBeenCalledWith('configuration');
  expect(() => registry.setConfiguration('translator','unknown',true)).toThrow('Invalid');
  expect(() => registry.setConfiguration('translator','prefix',false)).toThrow('Invalid');
  expect((await translate(registry)).lines[0]?.text).toBe('twoSame');
  registry.setEnabled('translator',false); expect(logger.info).toHaveBeenCalledWith('dispose'); expect(registry.providers('lyrics.translation')).toEqual([]);
  await expect(translate(registry)).rejects.toThrow('unavailable');
  registry.setEnabled('translator',true); await translate(registry);
  expect(data.get('plugin:translator:storage:count')).toBe('2');
  expect(new MusicPluginRegistry(options).configuration('translator')).toEqual({prefix:'two'});
  registry.uninstall('translator'); expect(registry.providers('lyrics.translation')).toEqual([]);
  expect(logger.info.mock.calls.filter(([kind]) => kind==='dispose')).toHaveLength(2);
 });
 it('cancels provider work on request cancellation and on disable; stale results cannot escape', async () => {
  const {registry,logger} = fixture(code.replace("signal.throwIfAborted();", "await new Promise(resolve => signal.addEventListener('abort', () => {context.logger.info('aborted'); resolve();}, {once:true}));"));
  const cancel = new AbortController(); const result = translate(registry,cancel.signal);
  await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith('activate',expect.anything()));
  await new Promise(resolve => setTimeout(resolve,10));
  cancel.abort(new Error('caller cancelled')); await expect(result).rejects.toThrow('caller cancelled'); expect(logger.info).toHaveBeenCalledWith('aborted');
  const second = translate(registry); await new Promise(resolve => setTimeout(resolve,10)); registry.setEnabled('translator',false);
  await expect(second).rejects.toThrow('inactive');
 });
 it('cleans subscriptions appended by an activation that finishes after disablement', async () => {
  const {registry,logger} = fixture(`exports.activate=async c=>{await new Promise(r=>c.logger.info('started',r));c.subscriptions.push({dispose:()=>c.logger.info('late cleanup')});return {dispose:()=>c.logger.info('late result cleanup')};};`);
  const result=translate(registry);const assertion=expect(result).rejects.toThrow('inactive');
  await vi.waitFor(()=>expect(logger.info).toHaveBeenCalledWith('started',expect.any(Function)));
  registry.setEnabled('translator',false);await assertion;
  const finish = logger.info.mock.calls.find(([kind])=>kind==='started')?.[1] as (()=>void);finish();
  await vi.waitFor(()=>expect(logger.info).toHaveBeenCalledWith('late cleanup'));
  expect(logger.info).toHaveBeenCalledWith('late result cleanup');
 });
 it('replaces platform code immediately without restarting and disposes the old registrations', async () => {
  const {registry,root,logger} = fixture(); await translate(registry);
  const update = path.join(root,'update'); fs.mkdirSync(update);
  fs.writeFileSync(path.join(update,'manifest.json'),JSON.stringify({...manifest,version:'1.1.0'}));
  fs.writeFileSync(path.join(update,'index.cjs'),code.replace("+l.text", "+'updated'"));
  expect(registry.install(update)[0]?.restartRequired).toBeUndefined(); expect(logger.info).toHaveBeenCalledWith('dispose');
  expect((await translate(registry)).lines[0]?.text).toBe('oneupdated');
 });
 it('reports activation failure and cleans up partially registered subscriptions', async () => {
  const {registry,logger} = fixture(code.replace("exports.deactivate = () => {};",'').replace("context.extensions.register", "throw new Error('activation broken'); context.extensions.register"));
  await expect(translate(registry)).rejects.toThrow('activation broken');
  expect(registry.list()[0]?.error).toBe('activation broken'); expect(logger.info).toHaveBeenCalledWith('dispose'); expect(registry.providers('lyrics.translation')).toEqual([]);
 });
 it('validates result identity, repeated lines, partial results, duplicate and unknown line IDs', () => {
  const result = {documentId:'doc',documentRevision:'revision-1',targetLanguage:'zh',lines:[{lineId:'line-1',text:'translated'}]};
  expect(validateTranslationResult(result,request)).toEqual(result);
  for (const invalid of [{...result,documentRevision:'old'}, {...result,targetLanguage:'en'}, {...result,lines:[...result.lines,...result.lines]}, {...result,lines:[{lineId:'unknown',text:'x'}]}]) expect(() => validateTranslationResult(invalid,request)).toThrow();
 });
 it('enforces scoped SDK data and declared HTTPS origins without following redirects', async () => {
  const {host,directory} = fixture();
  fs.writeFileSync(path.join(directory,'index.cjs'),`exports.activate = async c => {
    c.storage.set('key',{nested:[1,true]}); c.secrets.set('token','private');
    c.logger.info('secret',c.secrets.get('token'));
    try {c.storage.get('../other')} catch(e) {c.logger.info('scope denied')}
    try {await c.network.fetchText('https://undeclared.example/')} catch(e) {c.logger.info('network denied')}
    c.logger.info(await c.network.fetchText('https://translate.example/api'));
    c.extensions.register('lyrics.translation','default',{translate:async()=>null});
  };`);
  const fetch = vi.fn().mockResolvedValue(new Response(null, {status:204})); vi.stubGlobal('fetch',fetch);
  const runtime = new PluginRuntime(manifest,path.join(directory,'index.cjs'),host); await runtime.activate();
  expect(fetch).toHaveBeenCalledWith('https://translate.example/api',expect.objectContaining({redirect:'error'}));
  expect(host.logger.info).toHaveBeenCalledWith('');
  expect(host.logger.info).toHaveBeenCalledWith('scope denied'); expect(host.logger.info).toHaveBeenCalledWith('network denied');
  expect(host.logger.info).toHaveBeenCalledWith('secret','private'); runtime.dispose();
 });
 it('bounds asynchronous requests even when the plugin ignores AbortSignal', async () => {
  vi.useFakeTimers(); const controller=new AbortController();
  const result=withDeadline(async()=>new Promise(()=>{}),controller.signal,100);
  const assertion=expect(result).rejects.toThrow('timed out'); await vi.advanceTimersByTimeAsync(100); await assertion;
 });
 it('allows music sources to use activate while preserving legacy provider calls', async () => {
  const selected: PluginManifest = {...manifest,id:'netease',extensionApis:{'music.source':'^1.0.0'},contributes:{providers:[{type:'music.source',id:'default',name:'New music'}]}};
  const {registry} = fixture(`exports.activate = c => c.extensions.register('music.source','default',{
    provider:{id:'netease',searchMusic:async()=>[{songmid:'1',songname:'Song',singer:[]}],getRecommendedSongs:async()=>[],getMusicUrl:async()=>({url:'https://audio.example/'}),getLyrics:async()=>({lyrics:'x'}),getPlaylists:async()=>[],getPlaylistSongs:async()=>[],requiresCookie:()=>false},
    invoke:async()=>null,validateCookie:async()=>({valid:true}),streamHeaders:()=>({})
  });`,selected);
  await expect(registry.call('netease','searchMusic',['q'])).resolves.toMatchObject([{songmid:'1'}]);
  await expect(registry.call('netease','validateCookie',['x'])).resolves.toEqual({valid:true});
  expect(registry.providers('music.source')[0]?.name).toBe('New music');
 });
});

describe('core 1.1 data, secret configuration and endpoint services', () => {
 const llm: PluginManifest = {...manifest,coreApi:'^1.1.0',extensionApis:{'lyrics.translation':'^1.1.0'},
  permissions:{network:['https://translate.example','http://localhost:11434'],secrets:'own'},
  contributes:{...manifest.contributes,configuration:{
   prefix:{title:'Prefix',type:'string',default:'one'},
   'api-key':{title:'Key',type:'string',default:'',format:'secret',description:'Stored encrypted'},
   endpoint:{title:'Endpoint',type:'string',default:'',format:'endpoint'},
  }}};
 const cacheCode = `exports.activate = c => c.extensions.register('lyrics.translation','default',{translate:async({document,targetLanguage}) => {
  const key = 'track-' + document.trackId;
  const hit = await c.cache.get(key);
  if (!hit) await c.cache.set(key, {text: c.configuration.get('api-key') + ':' + document.lines[0].text});
  const value = hit || await c.cache.get(key);
  return {documentId:document.id,documentRevision:document.revision,targetLanguage,lines:[{lineId:'line-0',text:(hit ? 'cached ' : '') + value.text}]};
 }});`;
 it('rejects invalid secret and endpoint declarations', () => {
  const {registry} = fixture(cacheCode,{...llm,permissions:{network:['https://translate.example']}});
  expect(registry.list()[0]?.error).toContain('configuration field');
  const insecure = fixture(cacheCode,{...llm,permissions:{network:['http://remote.example'],secrets:'own'}});
  expect(insecure.registry.list()[0]?.error).toContain('permissions');
 });
 it('stores secret fields as secrets, hides them from the renderer and persists the cache until uninstall', async () => {
  const {options,root,data} = fixture(cacheCode,llm);
  const dataDirectory = path.join(root,'data');
  const withData = new MusicPluginRegistry({...options,dataDirectory});
  withData.setConfiguration('translator','api-key','sk-test');
  expect(data.get('secret:api-key')).toBe('sk-test');
  expect(withData.configuration('translator')).toMatchObject({'api-key':''});
  expect((await withData.dataInfo('translator')).configuredSecrets).toEqual(['api-key']);
  const run = (target: MusicPluginRegistry) => target.translate('translator:default', request, new AbortController().signal, 'request-1');
  expect((await run(withData)).lines[0]?.text).toBe('sk-test:Same');
  expect(fs.readdirSync(path.join(dataDirectory,'translator'))).toEqual(['track-opaque.json']);
  const restarted = new MusicPluginRegistry({...options,dataDirectory});
  expect((await run(restarted)).lines[0]?.text).toBe('cached sk-test:Same');
  expect(await restarted.dataInfo('translator')).toMatchObject({cacheEntries:1});
  await restarted.clearCache('translator'); expect((await restarted.dataInfo('translator')).cacheEntries).toBe(0);
  await run(restarted); restarted.uninstall('translator');
  expect(fs.existsSync(path.join(dataDirectory,'translator'))).toBe(false);
 });
 it('grants configured endpoint origins, loopback HTTP and bounded fetch timeouts', async () => {
  const {host,directory} = fixture(cacheCode,llm);
  fs.writeFileSync(path.join(directory,'index.cjs'),`exports.activate = async c => {
    for (const url of ['https://custom.example/v1','http://localhost:11434/api','http://remote.example/']) {
      try { await c.network.fetchText(url,{timeoutMs:60000}); c.logger.info('allowed',url); } catch (e) { c.logger.info('denied',url); }
    }
    try { await c.network.fetchText('https://translate.example/',{timeoutMs:500000}); } catch (e) { c.logger.info('timeout rejected'); }
    c.extensions.register('lyrics.translation','default',{translate:async()=>null});
  };`);
  host.writeSetting('plugin:translator:configuration:endpoint',JSON.stringify('https://custom.example/v1'));
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async () => new Response('ok')));
  const runtime = new PluginRuntime(llm,path.join(directory,'index.cjs'),host); await runtime.activate();
  expect(host.logger.info).toHaveBeenCalledWith('allowed','https://custom.example/v1');
  expect(host.logger.info).toHaveBeenCalledWith('allowed','http://localhost:11434/api');
  expect(host.logger.info).toHaveBeenCalledWith('denied','http://remote.example/');
  expect(host.logger.info).toHaveBeenCalledWith('timeout rejected');
  expect(() => runtime.setConfiguration('endpoint','ftp://custom.example')).toThrow('Invalid');
  runtime.dispose();
 });
});

describe('lyrics.translation 1.2 provider languages and deadlines', () => {
 const declared = (fields: Record<string, unknown>, type = 'lyrics.translation'): PluginManifest => ({...manifest,
  ...(type === 'music.source' ? {id:'netease',extensionApis:{'music.source':'^1.0.0'}} : {}),
  contributes:{...manifest.contributes,providers:[{type,id:'default',name:'Translation',...fields}]}});
 it('exposes declared languages and rejects invalid language or timeout declarations', () => {
  const {registry} = fixture(code,declared({languages:['zh','zh-Hant','en'],timeoutSeconds:600}));
  expect(registry.list()[0]?.error).toBeUndefined();
  expect(registry.providers('lyrics.translation')[0]?.languages).toEqual(['zh','zh-Hant','en']);
  for (const fields of [{languages:[]}, {languages:['zh','ZH']}, {languages:['not a tag']}, {languages:'zh'},
   {timeoutSeconds:10}, {timeoutSeconds:601}, {timeoutSeconds:90.5}, {timeoutSeconds:'300'}]) {
   expect(fixture(code,declared(fields)).registry.list()[0]?.error).toContain('provider contribution');
  }
  expect(fixture(code,declared({languages:['zh']},'music.source')).registry.list()[0]?.error).toContain('provider contribution');
 });
 it('applies the declared deadline and tells the provider how much time is left', async () => {
  const reporting = code.replace('{signal}) =>', '{signal,timeoutMs}) =>').replace('signal.throwIfAborted();', "signal.throwIfAborted(); context.logger.info('timeout', timeoutMs);");
  const {registry,logger} = fixture(reporting,declared({timeoutSeconds:300}));
  await translate(registry);
  const timeout = logger.info.mock.calls.find(([kind]) => kind==='timeout')?.[1] as number;
  expect(timeout).toBeGreaterThan(290_000); expect(timeout).toBeLessThanOrEqual(300_000);
  const fallback = fixture(reporting);
  await translate(fallback.registry);
  expect(fallback.logger.info.mock.calls.find(([kind]) => kind==='timeout')?.[1]).toBeLessThanOrEqual(180_000);
 });
 it('abandons a provider that runs past its declared deadline', async () => {
  vi.useFakeTimers();
  const {registry} = fixture(code.replace("signal.throwIfAborted();", "await new Promise(() => {});"),declared({timeoutSeconds:20}));
  const result = translate(registry); const assertion = expect(result).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(20_000); await assertion;
 });
});
