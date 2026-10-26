# API 参考：核心 1.1.0

公共类型以 [plugin.ts](../../src/shared/plugin.ts) 为准；音乐数据类型见 [onlineMusic.ts](../../src/shared/onlineMusic.ts)。此文档只列出已经实现的接口。

## 清单与能力协商

```json
{
  "manifestVersion": 1,
  "id": "example-translation",
  "name": "Example translation",
  "version": "1.0.0",
  "main": "index.cjs",
  "coreApi": "^1.1.0",
  "extensionApis": { "lyrics.translation": "^1.2.0" },
  "optionalExtensionApis": { "future.annotation": "^1.0.0" },
  "permissions": { "network": ["https://translator.example", "http://localhost:11434"], "secrets": "own" },
  "contributes": {
    "providers": [{ "type": "lyrics.translation", "id": "default", "name": "Example", "languages": ["zh", "en"], "timeoutSeconds": 300 }],
    "configuration": {
      "style": { "title": "Style", "type": "string", "default": "plain", "enum": ["plain", "literary"] },
      "endpoint": { "title": "Base URL", "type": "string", "default": "", "format": "endpoint", "description": "Empty uses the official service" },
      "api-key": { "title": "API Key", "type": "string", "default": "", "format": "secret" }
    }
  }
}
```

只使用核心 1.0.0 能力的插件可以继续声明 `^1.0.0`；用到下文标注“核心 1.1”的能力时，声明 `"coreApi": "^1.1.0"`，旧宿主会明确拒绝而不是在运行时缺少接口。

`manifestVersion` 是清单格式版本；`version` 是插件自身版本；`coreApi` 和各 `extensionApis` 是兼容范围，互不等价。

ID、提供者本地 ID、存储/凭据/配置键均匹配 `^[a-z][a-z0-9-]{0,63}$`。提供者全局键为 `<pluginId>:<providerId>`。名称必须非空，插件版本支持 `x.y.z` 和预发布后缀；API 范围仅接受稳定的精确 `x.y.z`、`^x.y.z`、`~x.y.z`，不接受 `*`、比较表达式、范围并集或预发布 API。

宿主在读取包时协商必需 API，不兼容时阻止执行。可选 API 未知或版本不匹配时跳过；其提供者不得注册。声明的每个提供者必须引用必需或可选扩展声明；重复的类型/ID 被拒绝。清单额外字段可以保留供将来增加元数据，但不会自动获得能力；宿主已定义的提供者字段（如翻译提供者的 `languages`、`timeoutSeconds`）按其规则校验。

## 生命周期与注册

入口导出 `activate(context): void | Disposable | Promise<void | Disposable>`，可以导出 `deactivate(): void | Promise<void>`。不会调用旧 `createPlugin` 和新 `activate` 两套入口：由清单格式决定。

发现/安装新格式插件只读取清单；首次请求该插件的任意扩展时，异步激活一次。激活时必须注册所有已协商的声明。首次调用前，提供者列表显示的是清单声明，未保证激活成功。激活失败会清理已经注册的资源，插件页显示错误；停用后重新启用可以重试。

`context.extensions.register(type, id, provider)` 按扩展类型检查提供者并返回幂等 `Disposable`。宿主自动追踪这个注册，因此不必再放入 `subscriptions`。自己的监听器、定时器等清理项可以放入 `context.subscriptions`，或从 `activate` 返回一个清理项。配置监听器也自动追踪。

停用、卸载、替换代码、激活失败或退出应用时，宿主中止 `context.signal`，倒序清理所有追踪项，移除提供者并调用 `deactivate`。清理异常记入日志，不妨碍其他项。`deactivate` 异步等待上限为 5 秒，退出时不保证其完成；需要同步释放的资源放在 Disposable 中。普通 SDK 写入在停用后会拒绝，因此不要依赖停用后才保存数据。

单个异步激活/提供者请求上限为 20 秒；翻译请求默认上限为 180 秒（lyrics.translation 1.1 起，给大语言模型留出时间，期间专注模式先显示原文），1.2 起提供者可以用 `timeoutSeconds` 声明 20–600 秒，见下文。翻译每插件最多 4 个并发请求。超时/取消后的迟到结果不会展示，但无法强制终止插件自己创建且未清理的任务，插件必须监听 signal。一个请求失败不自动停用插件；激活失败使其能力不可用。

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
| `cache.get/set/delete/clear` | **核心 1.1**。异步的插件私有文件缓存，详见下文 |
| `network.fetchText(url, options?)` | 有界文本请求，详见下文 |

普通数据和配置分别使用数据库键 `plugin:<id>:storage:<key>` 与 `plugin:<id>:configuration:<key>`。凭据使用已有加密设置机制（`music-plugin:<id>:secret:<key>`）；QQ/网易云历史键保持映射。系统安全存储不可用时，凭据仅保留在当前会话，不写入明文或不可恢复的数据库值。插件代码不要读取或依赖这些内部键，使用 SDK 即可。

配置声明最多 64 项，类型为 `string`、`boolean` 或 `number`，必须有同类型默认值，可用字符串/数值 `enum` 限定可选项。插件页自动生成控件并保存；不支持 React 控件或任意配置 schema。普通字符串最多 16,384 字符，数值必须有限。

核心 1.1 为配置项增加两个可选字段：

| 字段 | 行为 |
| --- | --- |
| `description` | 显示在控件下方的说明文字，最多 1,024 字符（宿主不使用悬停提示） |
| `format: "secret"` | 仅限 `string`，默认值必须为空字符串，不能带 `enum`，且清单需声明 `permissions.secrets: "own"`。值存入该插件的同名凭据（与 `secrets.set(key)` 同一存储），插件页显示为密码框；宿主读取配置给界面时永远返回空字符串，只告知“已保存”状态。插件用 `configuration.get(key)` 或 `secrets.get(key)` 读取，最长 65,536 字符；保存空字符串即清除 |
| `format: "endpoint"` | 仅限 `string`，不能带 `enum`；值为空或允许的网络 URL（见下文 `fetchText` 的协议规则）。配置的 URL 的 origin 在其保存期间加入该插件的网络白名单，用户填写即视为授权，例如自定义的 OpenAI 兼容服务或本机模型服务 |

API key、token 等凭据使用 `secret` 字段或 `context.secrets`，不要作为普通配置或普通存储。

`network.fetchText` 的 options 是 `{ method?: 'GET' | 'POST', headers?: Record<string,string>, body?: string, signal?: AbortSignal, timeoutMs?: number }`。默认 GET；URL 的 origin 必须属于清单 `permissions.network` 声明的**精确 origin**（可含显式非默认端口），或当前 `endpoint` 配置值的 origin。协议为 HTTPS；核心 1.1 起也允许本机回环地址的 HTTP（`http://localhost`、`http://127.0.0.1`、`http://[::1]`，可带端口），供 Ollama、LM Studio 等本地服务使用。禁止 URL 凭据，不接受通配域名或子域继承。自动重定向被拒绝，避免凭据随重定向发往未声明域名。非 2xx 抛错，错误信息形如 `Plugin network HTTP 401: <响应前 500 字符>`，便于插件记录服务端的错误原因；请求 body 和响应 UTF-8 字节各最多 1,000,000。单次超时默认 20 秒，核心 1.1 可用 `timeoutMs` 设为 1–120,000 毫秒；生命周期和调用 signal 都可取消。返回字符串，JSON 由插件解析，不暴露 Response/流对象。

### 缓存（核心 1.1）

```ts
interface PluginCache {
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

`storage` 适合少量设置类数据：它在 SQLite 中，每次请求都会随快照发给插件进程，单值上限 64 KiB。翻译结果、接口响应这类按歌曲累积的数据使用 `context.cache`：

- 每个键一个 JSON 文件，位于 `<应用数据目录>/plugin-data/<plugin-id>/`（默认 `~/.la/plugin-data/<plugin-id>/`），在插件进程内直接读写，不进入请求快照。
- 键匹配 `^[a-z0-9][a-z0-9._-]{0,127}$` 且不含 `..`，可以容纳 `track-` 加 64 位十六进制 Track ID；值序列化后最多 1 MiB。写入先写临时文件再原子替换，读到损坏文件时删除并返回 `undefined`。
- 生命周期：跨重启、更新、停用保留；**卸载插件时删除**（配置、普通存储和凭据仍保留以便重装）。插件页显示缓存条目数和大小，并提供“清除缓存”按钮。
- 停用后调用会拒绝。宿主没有总量配额，插件应自行控制条目大小。

宿主内存中的 32 项译文缓存仍然存在，重启后清空；需要跨重启保留的结果由插件写入 `context.cache`。

## `lyrics.translation@1.3.0`

提供者方法：`translate(request, callContext): Promise<TranslationResult>`。callContext 含 `requestId` 和 `signal: AbortSignal`，每次调用独立；信号由宿主在插件进程内创建，不通过 IPC 传递 AbortSignal 对象。1.2 起 callContext 还含 `timeoutMs`：调用提供者时距宿主放弃这次请求还剩的毫秒数（已扣除激活耗时）。需要多次请求外部服务的插件应据此缩短单次超时，剩余时间不够时直接报错，而不是发出注定会被中止的请求；旧宿主不提供该字段，按 180 秒处理。

1.2 起翻译提供者的清单声明可以带两个可选字段，其他类型的提供者带这两个字段会被拒绝：

```json
{
  "type": "lyrics.translation", "id": "default", "name": "Example",
  "languages": ["zh", "zh-Hant", "en", "ja"],
  "timeoutSeconds": 300
}
```

- `languages`：支持的目标语言标签，按显示顺序排列，1–32 个，不区分大小写不能重复，语法与请求中的 `targetLanguage` 相同。插件卡片「设置」中的「目标语言」按该插件提供者的列表显示（名称用该语言自己的写法，如 `ja` 显示为「日本語」）；没有声明时显示默认的中文、英文、日语、韩语。用户保存的语言该提供者不支持时，宿主改用主语言相同的标签（`zh` → `zh-Hans`），没有则用列表第一项；保存的偏好不变，换回支持它的提供者时恢复。专注模式使用已启用的翻译提供者，同时启用多个时使用列表中的第一个。
- `timeoutSeconds`：整次翻译调用的期限，20–600 的整数，默认 180。它覆盖激活、所有外部请求和结果返回；进程级超时在此基础上多留 5 秒用于报告。

这两个字段只是元数据，旧宿主会忽略它们，所以声明 `^1.1.0` 的插件也可以写上：新宿主按声明执行，旧宿主仍按 1.1 行为（默认语言列表、180 秒）。只有插件依赖 1.2 行为时才需要声明 `"lyrics.translation": "^1.2.0"`。

```ts
interface TranslationRequest {
  document: {
    id: string;
    revision: string;
    trackId: string;
    sourceLanguage?: string;
    metadata?: { title?: string; artist?: string; album?: string }; // 1.1
    lines: readonly {
      id: string;
      text: string;
      startMs?: number;
      endMs?: number;
      words?: readonly { text: string; startMs: number; endMs: number }[];
    }[];
  };
  targetLanguage: string;
  cacheMode?: 'reload'; // 1.3：跳过缓存，成功后才替换已有译文
}
interface TranslationResult {
  documentId: string;
  documentRevision: string;
  targetLanguage: string;
  lines: readonly { lineId: string; text: string }[];
}
```

时间单位均为毫秒；没有真实时间信息的歌词省略时间字段。文档的 Track ID 是原 ID 的 SHA-256（64 位小写十六进制），同一首歌稳定不变，可作为插件缓存的键；不传本地路径、媒体 URL、Cookie、封面或播放状态。1.1 起 `metadata` 附带非空的歌名、歌手、专辑（各最多 1,024 字符），帮助翻译理解上下文；它不参与 revision 计算，没有时省略。revision 是规范化歌词内容与解析器版本的 SHA-256；行 ID 保留原行位置，重复文本和相同时间戳也不同。网易云视图添加的标题行不发给插件。未来可增加真实源语言、结束时间等可选字段，不应靠字段总数判断对象是否合法。

输出必须回显文档 ID、revision、目标语言，只允许输入中出现的 lineId，每个 ID 最多一次。可以返回部分行和空行列表；未返回的行只显示原文。每行文本上限 16,384 字符，最多 5,000 行，解析后的请求/响应 JSON 最多 1,000,000 字符；不接受 NaN/Infinity、重复输入行 ID。结果按 ID 对齐，不能按文本、时间戳或返回数组顺序匹配。宿主显示译文为文本，不执行 HTML。词级时间可保留用于服务理解，但翻译结果当前没有逐词时间。

宿主只在用户点击专注模式播放控件中的「翻译」按钮后才发出请求，加载歌词本身不会触发翻译。这次点击在本次会话内对该歌曲、提供者和目标语言保留：重新打开专注模式或回到这首歌时直接复用结果，插件状态（如配置）变化时按新状态重新请求；再次点击按钮只隐藏译文。专注模式隐藏、切歌、改变语言/提供者/配置、停用或卸载插件时，旧响应不会覆盖新视图。请求按文档 revision、提供者版本、目标语言和当前插件状态共享；最后一个消费者离开时取消。成功结果在当前渲染窗口内缓存，最多 32 项，不写入原歌词/音频标签或媒体库。缓存重启后清空。目标语言按上文 `languages` 的规则选择，请求中的 `targetLanguage` 总是提供者声明列表中的一项（未声明时为默认四种之一）。

### 单曲重译与清除（1.3）

提供者在清单中声明 `cacheControl: true`，并实现
`clearTranslation(request, callContext): Promise<void>`。这项能力依赖 1.3 行为，应声明
`"lyrics.translation": "^1.3.0"`；宿主在激活时检查清除方法，在提供者信息中返回能力标志。
未声明能力的提供者继续使用原有翻译按钮，不显示单曲管理入口。

- 重译使用 `translate({ ...request, cacheMode: 'reload' }, callContext)`。提供者必须跳过缓存，
  完整生成成功后再替换对应版本；失败不删除已有译文。宿主也跳过内存缓存，在生成期间和失败后继续显示旧译文。
- 清除以 `document.trackId + targetLanguage` 为范围，移除该歌曲该语言的所有风格／提示词缓存，
  不影响其他歌曲或语言，不调用模型。提供者须中止该范围内的旧任务，并保证迟到结果和进行中的缓存写入不能恢复已清除数据。
- 歌曲列表和封面墙的歌曲右键菜单提供「重新翻译本曲」和「清除本曲译文」（仅显示于已有歌词且启用插件支持管理的歌曲）。操作归属于选中的歌曲，菜单关闭和切歌不取消操作；通过现有通知报告结果。专注模式保持原有页面和翻译按钮。
  清除立即切回原文、取消当前会话的显示请求并失效相关内存缓存；切歌回来或重新打开专注模式均不会自动生成。
  只有再次主动点击翻译或重译才请求模型。清除失败显示错误，可手动重试；清除期间不能发起新的界面翻译操作。
- 清除调用同样使用独立 requestId / signal，执行期限为 20 秒；它只接收不透明歌曲标识与歌词文档，
  不授予插件音频文件访问权，也不修改原歌词和音频标签。

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

`pluginHostInfo()` 返回全宿主版本表；`pluginProviders(type)` 返回启用且无加载错误的清单声明。`pluginTranslate({ requestId, providerKey, request })` 调用翻译；`pluginClearTranslation({ requestId, providerKey, request })` 清除单曲当前语言的译文；`pluginCancel(requestId)` 取消同一窗口拥有的翻译或清除请求。requestId 匹配 `^[\w-]{1,128}$`，同窗口不能重复；主进程总计最多 64 个等待请求，窗口关闭自动取消。

`pluginConfiguration(id)` 和 `pluginSetConfiguration(id, key, value)` 供宿主设置页面使用，第三方插件使用 context.configuration。`pluginConfiguration` 对 `secret` 字段只返回空字符串；`pluginSetConfiguration` 写入 `secret` 字段时转存为该插件凭据。`pluginDataInfo(id)` 返回 `{ configuredSecrets, cacheEntries, cacheBytes }`，`pluginClearCache(id)` 清空该插件的缓存目录。管理插件的旧 `musicPlugin*` 桥接名称暂时保留，同一列表/安装器同时支持两种格式。它们不属于可供第三方任意调用的公开 SDK。

## 更新管理

清单可选 `update` 元数据声明初始发布来源，类型为 `PluginUpdateSource`。宿主负责持久化来源、检查版本和替换安装包；运行时 API 版本与分发清单的 `schemaVersion` 独立。详细合同见[插件更新与分发](updates.md)。
