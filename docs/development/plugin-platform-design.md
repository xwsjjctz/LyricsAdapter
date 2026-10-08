# 应用插件平台：API 与文档设计草案

状态：核心 1.0.0、music.source 1.0.0、lyrics.translation 1.0.0 和 FocusMode 对照译文已实现，旧音乐源 API v1 保持兼容。准确的已公开接口见[插件 API 文档](../plugins/README.md)。本文其余部分保留总体设计方向，播放器/媒体库/命令/自定义页面、独立进程隔离、通用插件市场等仍是后续设计，不属于当前 SDK。

## 设计目标

建立一个公共宿主 SDK，以及可以逐步增加的功能扩展点。音乐源、歌词翻译和界面贡献共用安装、生命周期、配置、日志和版本管理；各自的数据合同保持独立。

每个新增功能先确定宿主愿意开放的业务能力，再定义扩展点。插件依赖这些公共合同，宿主内部的组件、状态管理、数据库和 IPC 可以继续重构。开发者不需要依赖 `FocusMode.tsx`、`updateSlot`、React 版本或内部文件路径。

验收标准：一个插件可以在独立仓库构建，安装后声明的能力被宿主识别并使用，停用或卸载后资源被清理；宿主的内部重构不要求插件跟着修改。这个标准需要实现与兼容测试支撑，不能仅靠文档声明。

## 设计起点与后续缺口

| 领域 | 已有基础 | 平台化时需要补齐 |
| --- | --- | --- |
| 插件管理 | manifest、独立包、启用、卸载、下载校验 | 通用 manifest、生命周期、扩展注册表、版本协商 |
| 音乐源 | 独立协议实现、统一 provider 调用 | 动态来源和认证合同，移除固定来源分支 |
| 播放与曲库 | controller 拥有修改权限，UI 发出意图 | 将公共读取与操作映射到这些所有者，提供稳定 DTO |
| 歌词与 FocusMode | 独立歌词渲染层，AML 转换预留译文和罗马音字段 | 歌词文档、稳定行 ID、附加文本层及对应渲染 |
| 运行环境 | 可信 Node 插件可运行 | 超时、取消、清理、故障隔离；限制权限需要实际执行边界 |
| 第三方分发 | 官方安装包目录 | 作者信任、兼容筛选、第三方目录和更新规则 |

依据：[MusicPluginRegistry](../../electron/services/musicPluginRegistry.ts)、[PlayerViewModel](../../src/viewmodels/usePlayerViewModel.ts)、[FocusLyrics](../../src/components/focus-mode/FocusLyrics.tsx)、[AML 转换](../../src/components/focus-mode/amllLyrics.ts)、[现有歌词类型](../../src/types.ts)。当前内部歌词时间以秒表示，AML 转换成毫秒；`translatedLyric` 已接入插件译文，`romanLyric` 当前仍为空字符串。

## 三类公共接口

### 1. 公共宿主 SDK

这些服务属于宿主，插件通过受控接口使用。以下是模块边界，不是要求第一版全部实现的方法列表。

| 模块 | 读取或操作 | 边界 |
| --- | --- | --- |
| `context` / `events` | 当前曲目、视图与状态快照，低频领域事件 | 不暴露 DOM、React store、audio 元素和任意 IPC |
| `player` | 读取播放状态；按授权发送播放、暂停、seek 等意图 | 通过播放器 controller 校验和执行，不直接改 slot |
| `library` | 查询曲目；按授权提交元数据或导入意图 | 通过曲库 controller 执行，保留身份与持久化规则 |
| `lyrics` | 获取规范化歌词，查询扩展产生的附加文本层 | 原文、时间轴与翻译等附加内容分离 |
| `commands` | 注册可由用户触发的命令 | ID 归属插件，输入经校验，清理与生命周期绑定 |
| `configuration` | 声明配置字段、读取本插件配置、订阅变化 | 宿主渲染设置；版本变更有明确迁移策略 |
| `storage` / `secrets` | 本插件普通数据、缓存和敏感凭据 | 各自命名空间；普通 storage 不承担凭据保存 |
| `network` / `resources` | 受限请求、访问用户授权的资源 | 不默认提供文件系统、路径和其他插件的凭据 |
| `logger` | 诊断日志和错误关联 ID | 自动带插件 ID，避免输出敏感数据 |

读取接口返回不可变的公开快照；写接口表达业务意图。公共曲目 DTO 使用宿主生成的稳定引用，不直接导出包含本地路径、Cookie、`File` 和内部音频 URL 的整个 `Track` 对象。

SDK 使用带类型的请求、返回值和事件。传输层将错误规范化为稳定的代码，例如 `PERMISSION_DENIED`、`UNSUPPORTED_API`、`CANCELLED`、`TIMEOUT`、`PROVIDER_UNAVAILABLE`、`INVALID_RESULT`。避免将一个可调用任意方法的 `invoke(string, any[])` 作为公共平台 API。

### 2. 功能扩展点

插件通过注册 provider 提供能力；宿主负责调用、选择和展示结果。

| 扩展点示意 | 插件提供 | 宿主负责 |
| --- | --- | --- |
| `music.source` | 搜索、歌单、音频解析及认证能力 | 来源入口、播放、下载和曲库写入 |
| `lyrics.translation` | 按原文行返回指定语言的译文 | 选择翻译服务、缓存、对照展示与同步滚动 |
| `lyrics.romanization` | 行或词的发音辅助文本 | 显示位置和原文关联 |
| `lyrics.annotation` | 注释、词义或语法说明 | 内容展示、选中与导航 |
| `library.metadata` | 元数据建议或补全结果 | 用户选择、合并与保存 |
| `storage.provider` | 远端库的读写能力 | 资源授权、同步策略及曲库集成 |

这些名称和合同需逐项实施。不能因为注册表允许一个字符串，就认为宿主支持了对应功能。SDK 用类型映射描述已支持的扩展点，宿主用运行时 schema 校验；未知扩展点应报告兼容性错误。

一个插件可以提供多个扩展点。插件 ID、插件内 provider ID 和全局 provider 引用分别管理，避免不同作者注册同名 provider 时互相覆盖。默认服务由用户或明确的宿主策略选择，不按插件安装顺序决定。

### 3. 界面贡献

先开放由宿主渲染的声明式贡献：命令、设置表单、菜单动作、工具栏项，以及有明确数据合同的面板位置。例如 `focusMode.sidePanel`、`track.contextMenu`、`settings.pluginSection`；这些位置仍需逐项实现。

贡献应说明目标位置、条件、数据绑定和关联命令。布局、主题、键盘、无障碍和主窗口拖拽规则由宿主统一处理。插件不依赖 CSS 选择器，不直接修改组件树，也不获得任意 `updateSlot` 权限。

对照翻译的第一版只需要 `lyrics.translation` provider 与宿主内置展示模式，不需要插件自己创建 FocusMode 页面。若未来确有复杂交互需求，再增加隔离的 Web 面板及有限消息桥；普通 provider 不因此获得宿主 DOM 或 preload 访问权。

## FocusMode 对照翻译：一个完整的扩展例子

```mermaid
flowchart LR
  A[宿主解析歌词] --> B[规范化歌词文档]
  B --> C[宿主翻译服务与扩展注册表]
  C --> D[选中的翻译插件]
  D --> E[按行 ID 返回译文]
  E --> F[宿主校验与缓存]
  F --> G[FocusMode 或其他歌词界面]
```

插件提供翻译能力，FocusMode 提供对照布局。相同译文可以在普通歌词页、迷你播放器或导出功能中复用，不必再开发一个绑定页面名称的翻译 API。

### 拟议的数据合同

```typescript
interface LyricDocument {
  id: string;
  revision: string;
  trackId: string;
  sourceLanguage?: string;
  lines: readonly LyricLine[];
}

interface LyricLine {
  id: string;
  text: string;
  startMs?: number;
  endMs?: number;
  words?: readonly { text: string; startMs: number; endMs: number }[];
}

interface TranslationRequest {
  document: LyricDocument;
  targetLanguage: string;
}

interface TranslationResult {
  documentId: string;
  documentRevision: string;
  targetLanguage: string;
  lines: readonly { lineId: string; text: string }[];
}

interface ProviderCallContext {
  requestId: string;
  signal: AbortSignal;
}

interface LyricsTranslationProvider {
  id: string;
  translate(request: TranslationRequest, context: ProviderCallContext): Promise<TranslationResult>;
}
```

公开时间单位统一为毫秒，并在字段名中标明。转换在宿主边界完成，原文没有真实时间轴时省略时间，不把页面为显示而估算的时间冒充来源数据。公开语言标签采用一致的语言标记规则，并区别歌词语言、目标语言与应用界面语言。

行 ID 由规范化层分配。重复副歌、同一时刻的多行和分段均可区分，不能单用文本、时间戳或渲染后的数组下标作为身份。歌词修改后产生新 revision；页面附加的歌曲标题等装饰行不进入待翻译原文。

译文作为附加文本层保存，不直接覆盖原始 LRC/QRC/YRC、逐词时间或歌曲元数据。默认按原文行同步，第一版不承诺译文逐词对齐。宿主可提供上下对照、左右对照、仅原文等显示模式。保存到文件应通过明确的曲库意图另行处理。

### 请求、缓存与失败行为

- 在内容、目标语言、服务或影响输出的配置发生变化时申请翻译，不按播放帧或每次 `timeupdate` 翻译。
- 同时需要同一份译文的界面共享请求；切歌、歌词修改或需求消失时取消不再需要的请求。取消某一个视图的订阅不应误取消其他视图仍需要的工作。
- 缓存键包含文档 ID/修订、原文内容与解析版本、目标语言、provider 身份与版本、影响结果的配置摘要及必要的账户作用域；不包含凭据原文。缓存有容量、过期和清除策略。
- 结果必须匹配 document ID、revision、语言和已有行 ID。丢弃过期响应，拒绝重复或未知 ID、超长内容；允许部分行无译文，并保留原文显示。
- 请求设超时、并发与大小限制。已保存的原有译文与机器翻译标明来源，默认优先使用有效的既有译文；使用外部服务前让用户选择对应 provider。
- `AbortSignal` 是插件运行环境中的本地取消对象，不能直接序列化穿过 RPC。传输层使用 request ID 和取消消息，运行环境重建本地 signal，并处理取消与完成的竞争。

## Manifest、版本与兼容性

通用 manifest 应区分插件版本、manifest 格式、公共 core API 和使用的扩展点版本。以下使用当前清单字段，地址为示例地址。实际校验规则见[API 参考](../plugins/api.md)：

```json
{
  "manifestVersion": 1,
  "id": "example-lyric-translation",
  "name": "Example Lyric Translation",
  "version": "0.1.0",
  "main": "index.cjs",
  "coreApi": "^1.0.0",
  "extensionApis": { "lyrics.translation": "^1.0.0" },
  "permissions": {
    "network": ["https://translator.example"],
    "secrets": "own"
  },
  "contributes": {
    "providers": [{ "type": "lyrics.translation", "id": "default", "name": "Example Translation" }]
  }
}
```

翻译插件不需要播放器控制、曲库写入或本地文件访问权限。配置和 UI 贡献也应有版本化 schema，并在安装时检查 ID、类型、宿主兼容范围和请求的权限。

采用统一公共 SDK、按模块记录兼容性：同一 major 内保留已有语义，新增能力采用可选字段或明确的能力协商；破坏性变更提升相关 API major。只对发生变化的合同进行迁移，不因一个新面板而迫使所有音乐源插件重写。

文档须列出宿主版本、core API、扩展点 API 和 SDK 版本的兼容矩阵，提供弃用窗口、替代接口和迁移示例。TypeScript 编译通过不能替代运行时数据校验。

## 生命周期与运行边界

建议使用 `activate(context)`、`deactivate()`，注册和事件订阅返回 `Disposable`，宿主记录归属并在停用、卸载、更新和异常激活时统一清理。配置、provider 调用和插件级后台任务分别具有明确的取消与恢复规则。

插件按命令或 provider 需求激活；不在启动时加载所有已安装插件。UI 隐藏不等于整个插件必须卸载，宿主根据活跃消费者决定服务是否继续工作。停用后不接受新请求，对已有工作按合同取消或结束。

平台核心保留在宿主，第三方业务逻辑放入独立运行环境。运行环境通过受控 broker 使用 SDK；消息有类型、大小、超时、并发和版本检查。插件卡住或崩溃不应拖垮播放器，故障归属能够在插件页查看和恢复。

**独立进程不自动构成权限沙箱。** 若插件仍可任意使用 Node 文件和网络接口，就不能声称 manifest 限制了这些能力。公开第三方前，需要选择并验证实际限制这些入口的运行方式；需要完整 Node 能力的兼容插件应明确作为可信插件处理。当前音乐源 API v1 在主进程运行，不能被描述成已经满足此权限模型。

## 文档如何组织

公共文档按“平台、扩展点、示例、兼容”组织。SDK 类型、manifest schema 和文档示例共同作为版本发布内容，不将内部源码目录说明当成公共 API 参考。

以下为后续目录规划，目前不是已存在的链接：

```text
docs/plugins/
  overview.md                  # 适用范围、架构和支持状态
  getting-started.md           # 最小插件：创建、构建、安装、调试、发布
  concepts/
    lifecycle.md              # 激活、订阅、清理、后台任务
    permissions.md            # 实际权限模型和数据作用域
    versioning.md             # API 版本、兼容矩阵和弃用政策
  sdk/                        # 从公共类型生成的接口参考
  extension-points/
    music-source.md
    lyrics-translation.md
    lyrics-romanization.md
    ui-contributions.md
  guides/                     # 分页、缓存、超时、网络、凭据、调试
  migration/                  # 旧音乐源接口与后续 major 的迁移
  examples/                   # 已构建并通过宿主集成测试的独立示例
```

每份扩展点文档使用相同模板：使用场景、适用版本、所需权限、注册方式、输入输出、时间和身份语义、取消与并发、错误与降级、UI 消费方式、限制、测试和完整示例。明确标记已实现、实验性和设计中的接口。

SDK 注释生成方法参考，人工文档解释业务约束和完整流程。代码示例应直接取自可构建的示例工程；CI 编译、验证包与 schema，并运行宿主合同和集成测试。能力矩阵、示例与兼容声明一起更新。

最初提供两个验收样本：音乐源插件和歌词翻译插件。后一示例应能在原有歌词时间轴上显示对照译文，覆盖切歌、修订、取消、部分失败、停用和卸载，而不是只演示一次成功的 HTTP 请求。

## 建议实施顺序

1. **平台核心与兼容适配。** 提取通用插件管理、扩展注册、生命周期和 SDK 边界，为现有音乐源 API v1 提供适配器，保留 QQ/网易云 ID 与既有凭据。同步清理已移除子模块后残留的开发脚本和 CI 引用。
2. **打通歌词翻译。** 实现歌词文档、行 ID、翻译 provider、缓存/取消和宿主对照展示，用它验证平台确实服务于另一类功能。
3. **逐步开放 UI 与业务能力。** 增加声明式设置、命令和指定面板位置；按明确需求开放播放器和曲库意图。音乐源动态化、统一认证使用相同平台核心。
4. **公开 SDK 与开发者文档。** 发布公共类型、schema、兼容矩阵和通过真实宿主测试的模板；设计在内部样例验证后再承诺稳定。
5. **开放第三方目录。** 在运行边界、作者信任和兼容规则具备后加入第三方收录与更新。无需把市场服务作为平台核心的前置条件。

平台 API 的稳定性应来自两类真实插件的共同验证。提前一次性设计所有未来功能会产生难以维护的承诺；保留一致的注册和版本机制，再按需求新增扩展点更合适。


## 本次已落地范围

- 实际清单不需要 activationEvents；目前统一按首次提供者请求惰性激活。权限仅含 SDK 精确 HTTPS origin 与自身凭据。
- 已提供可打包 SDK、声明式普通配置、私有 JSON/凭据接口和自动生命周期清理。
- 已接入两种 Focus 歌词渲染器，提供稳定文档/行身份、请求取消、响应校验和窗口内有界缓存。
- 新旧包共用安装目录与管理页面，旧包仍由 createPlugin 兼容入口执行。
- 主应用与新插件目前仍运行于主进程，未实现本文设想的隔离进程/安全沙箱；未开放 player/library/context/events/commands 或任意 UI 注入。
- 开发脚本和主项目 CI 已脱离被移除的子模块；官方插件仓库继续独立发布。
