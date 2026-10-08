# API 参考：核心 1.0.0

公共类型以 [plugin.ts](../../src/shared/plugin.ts) 为准；音乐数据类型见 [onlineMusic.ts](../../src/shared/onlineMusic.ts)。此文档只列出已经实现的接口。

## 清单与能力协商

```json
{
  "manifestVersion": 1,
  "id": "example-translation",
  "name": "Example translation",
  "version": "1.0.0",
  "main": "index.cjs",
  "coreApi": "^1.0.0",
  "extensionApis": { "lyrics.translation": "^1.0.0" },
  "optionalExtensionApis": { "future.annotation": "^1.0.0" },
  "permissions": { "network": ["https://translator.example"], "secrets": "own" },
  "contributes": {
    "providers": [{ "type": "lyrics.translation", "id": "default", "name": "Example" }],
    "configuration": {
      "style": { "title": "Style", "type": "string", "default": "plain", "enum": ["plain", "literary"] }
    }
  }
}
```

`manifestVersion` 是清单格式版本；`version` 是插件自身版本；`coreApi` 和各 `extensionApis` 是兼容范围，互不等价。

ID、提供者本地 ID、存储/凭据/配置键均匹配 `^[a-z][a-z0-9-]{0,63}$`。提供者全局键为 `<pluginId>:<providerId>`。名称必须非空，插件版本支持 `x.y.z` 和预发布后缀；API 范围仅接受稳定的精确 `x.y.z`、`^x.y.z`、`~x.y.z`，不接受 `*`、比较表达式、范围并集或预发布 API。

宿主在读取包时协商必需 API，不兼容时阻止执行。可选 API 未知或版本不匹配时跳过；其提供者不得注册。声明的每个提供者必须引用必需或可选扩展声明；重复的类型/ID 被拒绝。清单额外字段可以保留供将来增加元数据，但不会自动获得能力。

## 生命周期与注册

入口导出 `activate(context): void | Disposable | Promise<void | Disposable>`，可以导出 `deactivate(): void | Promise<void>`。不会调用旧 `createPlugin` 和新 `activate` 两套入口：由清单格式决定。

发现/安装新格式插件只读取清单；首次请求该插件的任意扩展时，异步激活一次。激活时必须注册所有已协商的声明。首次调用前，提供者列表显示的是清单声明，未保证激活成功。激活失败会清理已经注册的资源，插件页显示错误；停用后重新启用可以重试。

`context.extensions.register(type, id, provider)` 按扩展类型检查提供者并返回幂等 `Disposable`。宿主自动追踪这个注册，因此不必再放入 `subscriptions`。自己的监听器、定时器等清理项可以放入 `context.subscriptions`，或从 `activate` 返回一个清理项。配置监听器也自动追踪。

停用、卸载、替换代码、激活失败或退出应用时，宿主中止 `context.signal`，倒序清理所有追踪项，移除提供者并调用 `deactivate`。清理异常记入日志，不妨碍其他项。`deactivate` 异步等待上限为 5 秒，退出时不保证其完成；需要同步释放的资源放在 Disposable 中。普通 SDK 写入在停用后会拒绝，因此不要依赖停用后才保存数据。

单个异步激活/提供者请求上限为 20 秒，翻译每插件最多 4 个并发请求。超时/取消后的迟到结果不会展示，但无法强制终止插件自己创建且未清理的任务，插件必须监听 signal。一个请求失败不自动停用插件；激活失败使其能力不可用。

## 核心服务

| 接口 | 行为 |
| --- | --- |
| `pluginId` | 当前插件 ID |
| `apiVersions.coreApi` | 当前宿主实际核心版本 |
| `apiVersions.extensionApis` | **当前插件已协商**的扩展版本，不包含被跳过的可选扩展 |
| `apiVersions.legacyMusicApi` | 兼容旧音乐 API，当前为 `1` |
| `signal` | 插件生命周期信号 |
| `logger.debug/info/warn/error(...args)` | 使用带插件 ID 前缀的宿主主进程日志；不应记录凭据或完整私人歌词 |
| `storage.get(key)` | 同步读取插件私有 JSON，缺失返回 `undefined` |
| `storage.set(key, value)` / `delete(key)` | 普通数据命名空间；单值 JSON 最多 64 KiB；不是密钥存储 |
| `secrets.get(key)` / `set(key, value)` | 需声明 `permissions.secrets: "own"`，只能通过 SDK 操作自身键；缺失返回空字符串，值最多 64 KiB |
| `configuration.get(key)` | 读取已声明的 string/boolean/number 值；缺失/损坏值回到清单默认值；未知键抛错 |
| `configuration.onDidChange(listener)` | 配置保存后的通知，返回自动追踪的 Disposable |
| `network.fetchText(url, options?)` | 有界 HTTPS 文本请求，详见下文 |

普通数据和配置分别使用数据库键 `plugin:<id>:storage:<key>` 与 `plugin:<id>:configuration:<key>`。凭据使用已有加密设置机制（`music-plugin:<id>:secret:<key>`）；QQ/网易云历史键保持映射。插件代码不要读取或依赖这些内部键，使用 SDK 即可。

配置声明最多 64 项，类型为 `string`、`boolean` 或 `number`，必须有同类型默认值，可用字符串/数值 `enum` 限定可选项。插件页自动生成控件并保存；不支持 React 控件、任意配置 schema 或密钥输入控件。普通字符串最多 16,384 字符，数值必须有限。密码和 token 不应作为普通配置。

`network.fetchText` 的 options 是 `{ method?: 'GET' | 'POST', headers?: Record<string,string>, body?: string, signal?: AbortSignal }`。默认 GET；URL 必须属于清单声明的**精确 HTTPS origin**（可含显式非默认端口），禁止 URL 凭据，不接受通配域名或子域继承。自动重定向被拒绝，避免凭据随重定向发往未声明域名。非 2xx 抛错；请求 body 和响应 UTF-8 字节各最多 1,000,000；单次超时 20 秒，生命周期和调用 signal 都可取消。返回字符串，JSON 由插件解析，不暴露 Response/流对象。

## `lyrics.translation@1.0.0`

提供者方法：`translate(request, callContext): Promise<TranslationResult>`。callContext 含 `requestId` 和 `signal: AbortSignal`，每次调用独立；信号由宿主在插件进程内创建，不通过 IPC 传递 AbortSignal 对象。

```ts
interface TranslationRequest {
  document: {
    id: string;
    revision: string;
    trackId: string;
    sourceLanguage?: string;
    lines: readonly {
      id: string;
      text: string;
      startMs?: number;
      endMs?: number;
      words?: readonly { text: string; startMs: number; endMs: number }[];
    }[];
  };
  targetLanguage: string;
}
interface TranslationResult {
  documentId: string;
  documentRevision: string;
  targetLanguage: string;
  lines: readonly { lineId: string; text: string }[];
}
```

时间单位均为毫秒；没有真实时间信息的歌词省略时间字段。文档的 Track ID 是原 ID 的 SHA-256，不传本地路径、媒体 URL、Cookie、封面或播放状态。revision 是规范化歌词内容与解析器版本的 SHA-256；行 ID 保留原行位置，重复文本和相同时间戳也不同。网易云视图添加的标题行不发给插件。未来可增加真实源语言、结束时间等可选字段，不应靠字段总数判断对象是否合法。

输出必须回显文档 ID、revision、目标语言，只允许输入中出现的 lineId，每个 ID 最多一次。可以返回部分行和空行列表；未返回的行只显示原文。每行文本上限 16,384 字符，最多 5,000 行，解析后的请求/响应 JSON 最多 1,000,000 字符；不接受 NaN/Infinity、重复输入行 ID。结果按 ID 对齐，不能按文本、时间戳或返回数组顺序匹配。宿主显示译文为文本，不执行 HTML。词级时间可保留用于服务理解，但翻译结果当前没有逐词时间。

专注模式隐藏、切歌、改变语言/提供者/配置、停用或卸载插件时，旧响应不会覆盖新视图。请求按文档 revision、提供者版本、目标语言和当前插件状态共享；最后一个消费者离开时取消。成功结果在当前渲染窗口内缓存，最多 32 项，不写入原歌词/音频标签或媒体库。缓存重启后清空。设置页当前提供中文、英文、日语、韩语；提供者协议接受符合语言标签语法的其他语言。

## `music.source@1.0.0`

提供者是 `MusicSourceProvider`，保留旧 `MusicPlugin` 的方法，提供者 ID 和歌单 source 扩展为 string：

```ts
context.extensions.register('music.source', 'default', {
  provider,       // OnlineMusicProvider，provider.id 必须等于插件 ID
  validateCookie,
  invoke,         // 保留旧登录/协议动作兼容
  streamHeaders,
});
```

为了保持已安装 QQ/网易云插件、音频代理和下载行为，此版本沿用 [旧音乐契约](../development/music-plugin-development.md)。必需方法和规范化 DTO 没有改变；新格式只是把构造入口改为能力注册。一个插件目前只能声明一个 `music.source`；使用可选扩展声明时也遵守这个约束。其他翻译提供者可有多个。

主界面仍通过已有音乐调用入口访问 QQ/网易云；不要借 `invoke` 访问任意主应用 IPC。音乐提供者只能获取和规范化数据，不能直接修改播放器、媒体库或播放槽。未来取消音乐源固定 ID/UI 登录耦合时，将作为独立功能增加能力或发布该扩展点新主版本。

## 宿主桥接（应用内部）

`pluginHostInfo()` 返回全宿主版本表；`pluginProviders(type)` 返回启用且无加载错误的清单声明。`pluginTranslate({ requestId, providerKey, request })` 调用翻译；`pluginCancel(requestId)` 取消同一窗口拥有的请求。requestId 匹配 `^[\w-]{1,128}$`，同窗口不能重复；主进程总计最多 64 个等待请求，窗口关闭自动取消。

`pluginConfiguration(id)` 和 `pluginSetConfiguration(id, key, value)` 供宿主设置页面使用，第三方插件使用 context.configuration。管理插件的旧 `musicPlugin*` 桥接名称暂时保留，同一列表/安装器同时支持两种格式。它们不属于可供第三方任意调用的公开 SDK。
