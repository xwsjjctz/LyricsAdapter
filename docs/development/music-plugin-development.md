# 音乐源插件开发指南（旧 API v1）（API v1）

新插件请优先阅读[通用插件 API](../plugins/README.md)和[迁移说明](../plugins/versioning.md)。本文继续描述已安装 QQ/网易云插件使用的兼容接口。

本文对应宿主 `ac893c8` 的实现与官方插件 `0.1.0` 的 SDK。面向协议实现的维护者和准备开发第三方音乐源的作者。安装使用说明见[音乐源插件](../music-source-plugins.md)。

整个应用的后续扩展设计见[应用插件平台草案](plugin-platform-design.md)。本文保留现行音乐源合同，不将歌词翻译、UI 贡献等拟议能力写成已支持接口。

## 先确认能接入到哪一层

当前架构已经支持独立构建、安装、启用和更新插件，但还没有开放任意音乐源的完整接入。**自定义 ID 的插件可以通过本地安装进入加载器，并被主进程调用；它不会自动出现在搜索、登录和播放器的音乐源入口中。**

| 场景 | 当前支持情况 |
| --- | --- |
| 独立维护 QQ 或网易云协议 | 支持；协议改动可以单独交付插件包 |
| 安装自定义 ID 的 `.laplugin` | 支持；管理页可以显示、禁用和卸载 |
| 新音乐源安装后参与搜索、歌单与播放 | 尚不支持；需要先扩展宿主的来源注册与调用链 |
| 第三方自定义登录或配置页面 | 尚不支持；现有界面和登录通道绑定 QQ、网易云 |
| 从任意 GitHub 仓库在线安装 | 尚不支持；内置目录只接受官方仓库的 QQ、网易云安装包 |
| 插件添加 UI、命令或歌词处理器 | 没有这些扩展点；当前合同只面向音乐源 |
| 第三方代码隔离、自动更新 | 尚未实现 |

因此，开发者现在可以贡献官方插件实现、制作兼容的替代实现，或用独立 ID 开发和测试新协议。不要为了让新音乐源出现而借用 `qq` / `netease` ID；同 ID 的安装会替换已有插件，并共享该 ID 的凭据空间。

## 代码在哪里

| 用途 | 实现 |
| --- | --- |
| 宿主合同与 manifest 类型 | [src/shared/musicPlugin.ts](../../src/shared/musicPlugin.ts) |
| 歌曲、歌单、音质和 provider 合同 | [src/shared/onlineMusic.ts](../../src/shared/onlineMusic.ts) |
| 安装、加载、校验及调用白名单 | [musicPluginRegistry.ts](../../electron/services/musicPluginRegistry.ts) |
| 凭据、IPC 和登录兼容通道 | [musicPluginHandlers.ts](../../electron/ipc/musicPluginHandlers.ts) |
| 流媒体代理 | [streamProtocol.ts](../../electron/protocols/streamProtocol.ts) |
| 官方目录和下载校验 | [musicPluginCatalog.ts](../../electron/services/musicPluginCatalog.ts) |
| 界面来源筛选 | [musicPluginStore.ts](../../src/stores/musicPluginStore.ts) |
| renderer 的 provider 与凭据选择 | [onlineMusicProvider.ts](../../src/services/onlineMusicProvider.ts) |
| 官方插件 SDK | [固定版本 src/sdk.ts](https://github.com/xwsjjctz/LyricsAdapter-Music-Plugins/blob/fa3a3a6e2f1731e1ec0709412121330b06cb3820/src/sdk.ts) |

官方 SDK 目前是仓库中的 TypeScript 源文件，没有可直接安装的公共 SDK npm 包。它的 `OnlineSource` 也只包含 `qq | netease`；新增来源不能仅通过导入 SDK 完成。不要使用类型断言掩盖宿主尚未支持的来源。

## 插件的职责与运行环境

插件在 Electron **主进程**中执行。入口必须是自包含的 CommonJS `.cjs` 文件，导出同步的 `createPlugin(host)`。异步网络请求放在返回对象的方法中，初始化过程保持轻量。

插件负责平台请求、响应规范化、音频地址解析、歌词获取和认证协议。界面、播放状态、音乐库写入、歌词解析、下载文件和元数据写入由宿主负责。插件不应导入宿主的 React 组件、控制器、数据库或 Electron 内部模块。

开发使用 Node 24 系列，与项目要求一致。TypeScript 或多文件实现可参照官方 `scripts/build.mjs`，打包为单个 `.cjs`；官方构建目标为 `node22`。用户安装时不会运行 npm，也不会安装插件的依赖或额外资源。当前安装器只保存 manifest 和入口文件，不适合需要旁边的配置文件、动态加载的 JS chunk 或 `.node` 二进制的包。

插件具有宿主进程的 Node 权限。`host` 的凭据命名空间是协作接口，不能阻止插件直接访问文件或网络。SHA-256 验证下载内容的一致性，不是作者签名或权限沙箱。

## Manifest

示例项目的 `manifest.json`：

```json
{
  "id": "demo-source",
  "name": "Demo Music Source",
  "version": "0.1.0",
  "apiVersion": 1,
  "main": "index.cjs",
  "requiresCookie": false,
  "capabilities": ["search"]
}
```

| 字段 | 约束 |
| --- | --- |
| `id` | 匹配 `^[a-z][a-z0-9-]{0,63}$`；安装目录名和 `provider.id` 必须一致 |
| `name` | 非空名称 |
| `version` | `数字.数字.数字`，可带预发布后缀；当前校验不接受 `+build` 后缀 |
| `apiVersion` | 当前只能是 `1`；插件版本与 API 版本是两回事 |
| `main` | 同目录 `.cjs` 文件名；不能包含路径分隔符，也不能是符号链接 |
| `requiresCookie` | 布尔值，与 provider 的 `requiresCookie()` 保持一致 |
| `capabilities` | 字符串数组；官方使用 `search`、`playlists`、`lyrics`、`stream`、`qr-login` |
| `homepage` | 可选；存在时必须以 `https://` 开头 |

当前加载器并未按 capabilities 自动放宽必需方法，也未完整验证这些能力名称。声明 `search` 是界面判断可用音乐源的条件之一，但不能绕过 QQ / 网易云来源筛选。只声明实际实现的能力。

## `createPlugin(host)` 合同

返回对象必须提供：

| 成员 | 用途 |
| --- | --- |
| `provider` | 统一的音乐数据和音频地址接口 |
| `validateCookie(cookie)` | 返回 `Promise<{ valid: boolean; message?: string }>` |
| `invoke(action, args)` | 处理宿主已有的登录与协议兼容通道 |
| `streamHeaders(cookie)` | 同步返回音频 CDN 请求头，如 Referer、User-Agent 和认证字段 |

`invoke` 目前不是任意第三方 action 的公共入口：宿主只注册了 QQ 和网易云的固定兼容通道。新来源的登录协议需要先设计宿主入口，单独增加一个 action 名称不会被界面调用。

`host` 只约定以下能力：

| 成员 | 用法 |
| --- | --- |
| `logger.debug/info/warn/error` | 应用日志；不要输出 Cookie、token 或 credential 原文 |
| `readSecret(name)` | 同步读取本插件凭据，未保存时返回空字符串 |
| `writeSecrets(entries)` | 同步提交 `Record<string, string>`；保存受宿主的敏感数据持久化策略约束 |

凭据名称与插件 ID 使用同样的字符规则，例如 `cookie`、`access-token`。自定义插件的键由宿主映射到 `music-plugin:<id>:secret:<name>`；QQ、网易云的既有凭据键保留兼容映射。通过此接口保存凭据，避免依赖用户数据目录的物理布局。

### Provider 方法和返回数据

| 方法 | 返回与约定 |
| --- | --- |
| `searchMusic(query, limit?)` | `Promise<OnlineSong[]>` |
| `getRecommendedSongs()` | `Promise<OnlineSong[]>` |
| `getSongDetails(songmids)` | 可选的批量元数据补全；返回 `Promise<OnlineSong[]>` |
| `getMusicUrl(songmid, quality, mediaMid?)` | `Promise<{ url, bitrate, quality }>`；`quality` 是实际提供的音质 |
| `getLyrics(songmid)` | `Promise<{ lyrics, wordLyrics?, wordLyricsFormat? } \| null>` |
| `getPlaylists()` | `Promise<PlaylistInfo[]>` |
| `getPlaylistSongs(playlistId, offset?, limit?)` | `Promise<OnlineSong[]>`；遵守分页参数 |
| `requiresCookie()` | 同步返回是否必须登录 |
| `getCoverUrl(song)` | 同步返回封面 URL；宿主可用它补全 `coverUrlFullSize` |
| `getRawCookie()` / `hasCookie()` | SDK 约定的同步凭据访问方法 |

运行时会检查前述搜索、推荐、音频、歌词、歌单、歌单歌曲以及 `requiresCookie` 方法。SDK 还要求封面和凭据方法，因此实现时应完整遵循合同；`getSongDetails` 可省略。暂未实现的列表功能可返回空数组，歌词可返回 `null`，无法提供音频时应抛出明确错误。

歌曲至少包含 `songmid: string`、`songname: string`、`singer: { name: string }[]`。这些字段沿用历史 QQ 命名，`songmid` 可以承载其他平台的字符串 ID。`interval` 单位为秒。封面可提供 `coverUrl` / `coverUrlFullSize`，专辑可提供 `albumname` / `albummid`。

歌单包含 `id`、`name`、`coverUrl`、`songCount`、`source`；其中 `source` 在当前 SDK 中仍限于 QQ / 网易云。音质只接受 `128`、`320`、`flac`、`m4a`。无损不可用时可提供较低音质，但必须报告实际 `quality`。

歌词以 `lyrics` 提供纯文本或 LRC，可同时提供 QRC / YRC 字词歌词。当前 `wordLyricsFormat` 只认识 `qrc` 和 `yrc`。不要返回音频文件内容、React 元素、函数或流对象；provider 的返回值需要跨 IPC 传递。

主进程通用调用只允许表中的七个异步数据方法及 `validateCookie`，参数数组最多五项。`getCoverUrl` 由宿主内部调用，`requiresCookie` 和 `streamHeaders` 由音频链路使用。新增方法不会自动成为可调用接口。

## 可运行的加载器示例

这个示例验证自定义 ID 的安装、加载与调用，只有内存中的搜索数据，不提供音频，也不会在当前在线音乐界面中出现。它使用 JavaScript，避免把尚未泛化的 TypeScript 来源类型误当作可用接口。

目录结构：

```text
demo-music-plugin/
  manifest.json
  src/index.cjs
  scripts/package.mjs
  test/plugin.test.cjs
```

`manifest.json` 使用上面的示例。`src/index.cjs`：

```javascript
exports.createPlugin = function createPlugin(host) {
  const song = { songmid: 'demo-001', songname: 'Demo song', singer: [{ name: 'Demo artist' }], interval: 180 };
  return {
    provider: {
      id: 'demo-source',
      async searchMusic(query, limit = 20) {
        if (typeof query !== 'string' || !Number.isInteger(limit) || limit < 0) throw new Error('Invalid search arguments');
        return song.songname.toLowerCase().includes(query.toLowerCase()) ? [song].slice(0, limit) : [];
      },
      async getRecommendedSongs() { return []; },
      async getMusicUrl() { throw new Error('Demo plugin has no audio stream'); },
      async getLyrics() { return null; },
      async getPlaylists() { return []; },
      async getPlaylistSongs() { return []; },
      getCoverUrl(song) { return song.coverUrlFullSize || song.coverUrl || ''; },
      getRawCookie() { return host.readSecret('cookie'); },
      hasCookie() { return Boolean(host.readSecret('cookie')); },
      requiresCookie() { return false; },
    },
    async validateCookie() { return { valid: false, message: 'Demo plugin does not implement login' }; },
    async invoke(action) { throw new Error(`Unsupported action: ${action}`); },
    streamHeaders() { return {}; },
  };
};
```

`scripts/package.mjs` 使用 Node 内置模块，不需要安装额外依赖：

```javascript
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const code = await readFile(path.join(root, 'src/index.cjs'), 'utf8');
const output = path.join(root, 'dist');
await mkdir(output, { recursive: true });
const bytes = JSON.stringify({ manifest, code, sha256: createHash('sha256').update(code).digest('hex') });
await writeFile(path.join(output, `${manifest.id}.laplugin`), bytes);
console.log(`${manifest.id}.laplugin SHA-256: ${createHash('sha256').update(bytes).digest('hex')}`);
```

`.laplugin` 是 UTF-8 JSON，内容为 `{ manifest, code, sha256 }`。内部 `sha256` 对代码字符串的 UTF-8 字节计算，分发摘要对整个安装包计算。入口代码最多 20 MiB，整个安装包最多 24 MiB，安装目录中的 manifest 最多 64 KiB。

`test/plugin.test.cjs`：

```javascript
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPlugin } = require('../src/index.cjs');

test('search normalizes data and unsupported playback fails clearly', async () => {
  const plugin = createPlugin({ logger: { debug() {}, info() {}, warn() {}, error() {} }, readSecret: () => '', writeSecrets() {} });
  assert.equal(plugin.provider.id, 'demo-source');
  assert.deepEqual(await plugin.provider.searchMusic('Demo', 1), [
    { songmid: 'demo-001', songname: 'Demo song', singer: [{ name: 'Demo artist' }], interval: 180 },
  ]);
  assert.deepEqual(await plugin.provider.searchMusic('missing'), []);
  await assert.rejects(plugin.provider.getMusicUrl('demo-001', '320'), /no audio stream/);
  assert.equal(await plugin.provider.getLyrics('demo-001'), null);
});
```

在示例目录运行：

```sh
node --test test/plugin.test.cjs
node scripts/package.mjs
```

然后在开发应用的设置 → 插件中安装 `dist/demo-source.laplugin`。安装后应出现在已安装列表；没有在线音乐来源入口是当前的预期行为。主进程加载器集成可参照 [musicPluginCatalog.test.ts](../../test/electron/services/musicPluginCatalog.test.ts)，使用临时目录实例化 `MusicPluginRegistry`，通过 `installPackage` 和 `call` 验证它。

## 安装、更新与分发

安装后的目录为应用数据目录下的 `plugin/<id>/`，默认是 `~/.la/plugin/<id>/`，插件页面显示实际路径。只保存 `manifest.json` 和 manifest 指定的入口文件。

首次安装在启用时可立即加载；更新已有插件后需要重启。禁用会阻止后续调用，卸载会移除安装文件；两者保留凭据和用户音乐数据。当前没有 `activate` / `deactivate` / `dispose` 生命周期回调，已开始的请求或插件自行创建的定时器不会因此自动清理。不要在 `createPlugin` 中启动常驻任务；网络方法应自行设置超时、限制响应大小并处理失败。

第三方作者可以在自己的仓库中公开源码、构建说明、许可证与 `.laplugin` 文件，供用户下载后本地安装。仅发布自己的 `catalog.json` 或 GitHub Release，不会被当前应用自动发现。官方在线目录固定为 `LyricsAdapter-Music-Plugins/main/packages/catalog.json`，并只接受 `qq` 与 `netease`。

官方构建脚本还把这两个 ID 写在循环中，新增来源需要调整脚本。借用官方实现时保留项目及依赖的许可证和第三方声明；不要把示例的空数组、无音频 stub 当成可发布的完整音乐源。

## 接入真实协议时要验证什么

- 将远端 ID、艺人、时长、封面和分页结果转换为合同数据；覆盖空结果、缺少字段和重复页。
- 测试匿名访问、过期凭据、续期失败和重新登录；避免多个并发请求重复续期。
- 检查实际音质和音频 URL 有效期；由宿主处理 `stream://`、Range 传输、下载落盘与元数据。
- 普通调用与音频解析可能同时发生，方法需要能处理并发；提供请求超时和明确错误。
- 在临时用户目录中验证首次安装、禁用、启用、更新后重启、卸载和凭据保留，不依赖开发者已有登录状态。

宿主集成测试见 [electron.music-plugins.spec.ts](../../test/e2e/electron.music-plugins.spec.ts)。使用项目的隔离测试约定，详情见 [DEBUGGING.md](../../DEBUGGING.md)。

## 让第三方新增来源真正开箱可用，需要哪些后续改造

以下是建议实施顺序，**不是 API v1 已有能力，也不是这份文档新增的接口**。

1. **动态来源注册与统一调用。** 将 `OnlineSource`、SDK 和来源筛选改为可注册的 ID；renderer 为已安装 provider 创建通用代理。搜索、推荐、歌单、下载和播放器根据注册信息调用，移除固定的 QQ / 网易云分支。保留现有 ID、歌曲身份和用户数据的兼容性。
2. **统一认证和配置合同。** 增加认证状态、开始登录、轮询、刷新、退出等标准接口，以及由宿主渲染的配置描述。保留官方兼容通道作为过渡；不让插件必须编写或注入 React 页面。
3. **公开且独立版本的 SDK 与模板。** 收敛现在两份类型定义，提供宿主兼容范围和明确的 API 演进策略。让模板能构建、通过合同检查，并在宿主中搜索与播放；使用 capabilities 决定可选方法和入口。
4. **生命周期与故障隔离。** 补齐停用、卸载和退出时的资源清理，设置调用超时和并发约束；评估独立进程承载插件。进程隔离有助于减少卡死或崩溃影响，但仍需单独设计权限边界。
5. **再开放第三方目录。** 定义第三方来源的信任方式、兼容筛选、包校验、版本与更新规则，随后支持仓库订阅或市场收录。当前官方目录可继续保留，无需先建设独立市场服务。

验收标准应是：维护者新建一个独立插件仓库，使用自己的 ID，构建并安装后即可在宿主完成搜索、播放、登录（如需要）和卸载，全程不修改宿主业务代码。当前 API v1 还未达到这个标准。
