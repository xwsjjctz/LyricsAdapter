import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { PluginElectronAPI, PluginProviderInfo } from '../../src/shared/plugin';
import type { MusicPluginElectronAPI } from '../../src/shared/musicPlugin';

const repo=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
type Bridge = Required<PluginElectronAPI & MusicPluginElectronAPI> & { settingsGet(key:string):Promise<string|undefined>; settingsSet(key:string,value:string):Promise<void> };
test('platform packages install, configure and translate in both Focus renderers; cancellation and disablement cross real IPC',async({},testInfo)=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'la-platform-e2e-')));
 const home=path.join(root,'home'),userData=path.join(root,'user-data');
 await mkdir(path.join(home,'.la'),{recursive:true});await mkdir(userData);
 await writeFile(path.join(home,'.la/settings.json'),JSON.stringify({'app-language':'en',la_focus_amll_lyrics_enabled:'false'}));
 await writeFile(path.join(userData,'library-index.json'),JSON.stringify({songs:[{id:'translation-fixture',title:'Translation fixture',artist:'LyricsAdapter',album:'Tests',duration:100,lyrics:'Original one\nOriginal two',syncedLyrics:[{time:0,text:'Original one'},{time:4,text:'Original two'}],source:'local',available:false}],settings:{activeSlotId:'local',localSlot:{currentTrackIndex:0,currentTime:0,volume:0.5,playbackMode:'order',scrollPosition:0,filterType:'default',categorySelection:null}}}));
 const packaged=spawnSync(process.execPath,[path.join(repo,'scripts/packagePlugin.mjs'),path.join(repo,'examples/plugins/lyric-translation'),root],{cwd:repo,encoding:'utf8'});
 expect(packaged.status,packaged.stderr).toBe(0);
 const packageFile=path.join(root,'example-translation.laplugin');
 const env=Object.fromEntries(Object.entries({...process.env,HOME:home,USERPROFILE:home,APPDATA:path.join(root,'appdata'),LOCALAPPDATA:path.join(root,'localappdata'),XDG_CONFIG_HOME:path.join(root,'config'),XDG_DATA_HOME:path.join(root,'data'),XDG_CACHE_HOME:path.join(root,'cache'),NODE_ENV:'test',LYRICS_ADAPTER_E2E_STATIC:'1',LYRICS_ADAPTER_DISABLE_NATIVE_GLASS:'1'}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));delete env['ELECTRON_RUN_AS_NODE'];
 let app:ElectronApplication|undefined;
 try {
  app=await electron.launch({cwd:root,args:[...(process.platform==='linux'?['--no-sandbox']:[]),`--user-data-dir=${userData}`,repo],env});
  const page=await app.firstWindow();await page.waitForFunction(()=>Boolean((window as unknown as { electron?: Bridge }).electron?.pluginHostInfo));
  await app.evaluate(({BrowserWindow,net})=>{BrowserWindow.getAllWindows()[0]?.focus();const originalFetch=net.fetch.bind(net);net.fetch=async(input,init)=>String(input).includes('LyricsAdapter-Music-Plugins')?new Response(JSON.stringify({apiVersion:1,plugins:[]})):originalFetch(input,init);});
  expect(await page.evaluate(()=>((window as unknown as { electron: Bridge }).electron).pluginHostInfo())).toMatchObject({coreApi:'1.0.0',legacyMusicApi:1,extensionApis:{'lyrics.translation':'1.0.0'}});
  await expect(page.locator('.poster-wall')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+K');const palette=page.locator('.command-palette__input');await palette.click();await page.keyboard.press('Shift+Tab');await palette.fill('settings');await page.keyboard.press('Enter');
  await page.getByRole('tab',{name:'Plugins'}).click();
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},packageFile);
  await page.getByRole('button',{name:'Install local plugin'}).click();
  const providers=await page.evaluate(()=>((window as unknown as { electron: Bridge }).electron).pluginProviders('lyrics.translation'));
  expect(providers).toMatchObject([{key:'example-translation:default'}] satisfies Partial<PluginProviderInfo>[]);
  await expect(page.getByRole('tab',{name:'Online Music'})).toHaveCount(0);
  await page.getByRole('textbox',{name:'译文前缀 / Translation prefix'}).fill('Test translation');
  await page.getByRole('button',{name:'Save plugin settings'}).click();
  await expect.poll(()=>page.evaluate(()=>((window as unknown as { electron: Bridge }).electron).pluginConfiguration('example-translation'))).toEqual({prefix:'Test translation'});
  await page.getByLabel('Translation plugin',{exact:true}).selectOption('example-translation:default');
  await page.screenshot({path:testInfo.outputPath('plugin-platform-settings.png')});
  await expect(page.getByLabel('Translation plugin',{exact:true})).toBeEnabled();
  await page.getByRole('tab',{name:'Plugins'}).click();await page.keyboard.press('Escape');await expect(page.locator('.settings-sheet')).toHaveCount(0);await page.getByRole('button',{name:/Enter Focus Mode/}).click();
  await expect(page.getByTestId('focus-legacy-lyrics')).toBeVisible();
  await expect(page.getByTestId('lyric-translation').first()).toHaveText('Test translation (zh) · Original one');
  await expect(page.getByTestId('lyric-translation').first()).toBeVisible();
  await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.focus-mode-content')!).opacity) >= 0.99);
  await page.screenshot({path:testInfo.outputPath('focus-parallel-translation.png')});
  await page.keyboard.press('ControlOrMeta+Enter');
  // Switch through persisted settings then reload, exercising independent AMLL conversion.
  await page.evaluate(()=>((window as unknown as { electron: Bridge }).electron).settingsSet('la_focus_amll_lyrics_enabled','true'));
  await page.reload();await expect(page.locator('.poster-wall')).toBeVisible();await page.getByRole('button',{name:/Enter Focus Mode/}).click();
  await expect(page.locator('.amll-lyric-player')).toBeVisible();await expect(page.locator('.amll-lyric-player')).toContainText('Test translation (zh) · Original one');
  await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.focus-mode-content')!).opacity) >= 0.99);
  await page.screenshot({path:testInfo.outputPath('focus-amll-parallel-translation.png')});
  await page.evaluate(()=>((window as unknown as {electron:Bridge}).electron).pluginSetConfiguration('example-translation','prefix','Updated translation'));
  await expect(page.locator('.amll-lyric-player')).toContainText('Updated translation (zh) · Original one');
  await expect(page.locator('.amll-lyric-player')).not.toContainText('Test translation');
  await page.evaluate(()=>((window as unknown as { electron: Bridge }).electron).musicPluginSetEnabled('example-translation',false));
  await expect(page.locator('.amll-lyric-player')).not.toContainText('Updated translation');
  await expect(page.locator('.amll-lyric-player')).toContainText('Original one');
  // Request cancellation is scoped to the owning webContents and reaches provider AbortSignal.
  const example=JSON.parse(await readFile(packageFile,'utf8')) as {manifest:Record<string,unknown>};
  const code=`exports.activate=c=>c.extensions.register('lyrics.translation','default',{translate:async(r,{signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>{c.storage.set('aborted',true);resolve({documentId:r.document.id,documentRevision:r.document.revision,targetLanguage:r.targetLanguage,lines:[]});},{once:true}))});`;
  const slowFile=path.join(root,'slow.laplugin');await writeFile(slowFile,JSON.stringify({manifest:{...example.manifest,id:'slow-translation',name:'Slow translation'},code,sha256:createHash('sha256').update(code).digest('hex')}));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},slowFile);
  await page.evaluate(()=>((window as unknown as { electron: Bridge }).electron).musicPluginInstall());
  const cancelled=await page.evaluate(async()=>{
   const api=(window as unknown as { electron: Bridge }).electron;
   const result=api.pluginTranslate({requestId:'cancel-probe',providerKey:'slow-translation:default',request:{targetLanguage:'zh',document:{id:'doc',revision:'rev',trackId:'opaque',lines:[{id:'line-0',text:'original'}]}}}).then(()=> 'unexpected success',error=>String(error));
   await new Promise(resolve=>setTimeout(resolve,100));api.pluginCancel('cancel-probe');return result;
  });
  expect(cancelled).toContain('cancelled');
  expect(await page.evaluate(()=>((window as unknown as { electron: Bridge }).electron).settingsGet('plugin:slow-translation:storage:aborted'))).toBe('true');
  await page.evaluate(()=>((window as unknown as { electron: Bridge }).electron).musicPluginUninstall('slow-translation'));
  expect(await page.evaluate(()=>((window as unknown as { electron: Bridge }).electron).pluginProviders('lyrics.translation'))).toEqual([]);
 } finally {await app?.close();await rm(root,{recursive:true,force:true});}
});
