# LyricsAdapter 变维拆分表（DVA Full Analysis）

> 分析时间：2026-06-14 | 分析者：Claude (per DVA methodology) | HEAD: cc5759e
> 数据来源：5 个 agent 全层代码通读 + 6 个月 git 历史 + 业务判断

---

## Step 1: 实体清单（Entities）

按"持有状态"判定。**不带行为的贫血实体优先，充血实体单独标出。**

### 核心域实体
| ID | 实体 | 持有的状态 | 当前住所 |
|----|------|-----------|---------|
| E1 | **Track** | id, title, artist, album, duration, coverUrl, lyrics, syncedLyrics, audioUrl, filePath/source/webdav/cdnUrl | `types.ts:11` 贫血，被 13 处直接 mutate |
| E2 | **LibrarySlot** | id (local/cloud), tracks[], currentTrackIndex, currentTime, volume, playbackMode, scrollPosition, filterType, categorySelection | `types.ts:46` 贫血 |
| E3 | **PlaybackContext** | currentTrack, isPlaying, currentTime, duration, volume, playbackMode | **双源**：usePlayback 内 useState + LibrarySlot 同名字段 |
| E4 | **Lyrics** | plainText 或 SyncedLyricLine[] | 散落，无独立实体 |
| E5 | **Cover** | 文件路径 / data URL / blob URL | 散落 |
| E6 | **Metadata** | title/artist/album/lyrics/cover/duration | 解析结果直接铺平到 Track |
| E7 | **BlobURL** | url string + 引用计数 | `useBlobUrls` 仅做 ref 追踪 |
| E8 | **AudioElement** | HTMLAudioElement + 事件绑定 | 直接挂在 App.tsx JSX |

### 外部服务域实体
| ID | 实体 | 状态 | 当前住所 |
|----|------|------|---------|
| E9 | **Cookie** (QQ Music) | cookieString, lastValidatedAt | `cookieManager` → IndexedDB 明文 |
| E10 | **WebDAVConfig** | serverUrl, username, password, provider | `webdavClient` → localStorage 明文 |
| E11 | **WebDAVFile** | path, name, size, isDirectory, contentType | 临时对象 |
| E12 | **WebDAVMetaIndex** | sidecar `_metadata_index.json` | useWebDAV 内存 + IndexedDB |
| E13 | **QQMusicSong** | songmid, title, singer, album, interval | search API 返回 |

### 配置 / 偏好域实体
| ID | 实体 | 状态 | 当前住所 |
|----|------|------|---------|
| E14 | **Theme** | id, name, colors, fontFamilies | `themeManager` 单例 + localStorage |
| E15 | **ShortcutBinding** | action → accelerator | `shortcutManager` + localStorage |
| E16 | **Settings** | downloadPath, floatingPanelEnabled, bgBlurTrans | `settingsManager` + localStorage |
| E17 | **ViewMode** | library/browse/metadata/settings/theme/player/lyrics | App.tsx useState |
| E18 | **UpdateInfo** | latestVersion, downloaded, readyToInstall | `updater.ts` 单例 |

---

## Step 1.5: Git 历史证据（已完成，见 `.dims/history-marker`）

**关键证据**：
- App.tsx 85 commits —— **远高于任何其他文件**，证明状态中枢在持续被改
- LibraryView 70 / FocusMode 38 —— UI 局部迭代密度高
- preload 20 + main.ts 31 + desktopAdapter 27 —— IPC 接口在持续膨胀
- indexedDBStorage 15 —— 标 deprecated 但 commits 持续 → **不是死代码**
- SettingsDialog 10 —— 与 SettingsView 同期活跃 → **重复实现**
- src-tauri 9 commits 后删除 —— **架构选型曾动摇**，但短期不会切

---

## Step 2: 关系清单 + 变化速率标注

> Rate: H/M/L | Trend: O(oscillate) / G(grow) / S(stable)

### 高频震荡（H/O）—— 最值得拆

| ID | 关系 | 当前住所 | Rate | Trend | Git证据 | 异变原因 |
|----|------|---------|------|-------|---------|---------|
| **R1** | Track → 元数据解析（ID3/FLAC/MP4） | metadataService(1011) + worker(586) + coverArtService(371) **三份重复** | H | O | metadataService 19 commits | 不同格式解析逻辑反复调整；同时 worker 主线程重复维护 |
| **R2** | PlaybackContext ↔ audio element 同步 | App.tsx:626 直接挂 7 事件 + usePlayback 30+ 字段 | H | O | usePlayback 27 commits | 播放器状态机边界没拉开，bug 反复出（最近修了 5 个跨 slot 切换 bug） |
| **R3** | LibrarySlot 持久化 | libraryStorage + indexedDBStorage **双轨并存** | H | O | libraryStorage 18 + indexedDBStorage 15 | 何时走哪个不清晰，标 deprecated 的没真废弃 |
| **R4** | LibraryView 内的子模式（list/edit/category/search） | LibraryView.tsx 1685 行单文件 | H | O | LibraryView 70 commits | UI 各模式独立迭代但挤在一起，行渲染逻辑两份重复 |
| **R5** | App.tsx 状态中枢（含 QQ 音乐 pipeline / 主题注入 / IPC 调度） | App.tsx 13 useCallback + 9 ref + 11 useEffect | H | O | App.tsx 85 commits | 4 类无关职责混在同一处，每改一类都动它 |
| **R6** | Cookie 校验与刷新 | cookieManager.validateCookie 网络失败假成功 | M | O | cookieManager 168 行无 commits 修正 | 与 QQ 音乐 API 调用强耦合，错误语义不明确 |

### 中频增长（M/G）—— 需要可扩展抽象

| ID | 关系 | 当前住所 | Rate | Trend | Git证据 | 异变原因 |
|----|------|---------|------|-------|---------|---------|
| **R7** | WebDAV provider 探测与配置 | `webdav/providerConfig.ts` 已抽出 | M | G | webdavClient 14 commits + providerConfig 新增 | 已部分外化，但 client 本体还混着通用 PROPFIND 与 123pan 专用逻辑 |
| **R8** | QQ 音乐 API（search/url/lyrics/download） | `qqMusicApi.ts` 634 行单类 | M | G | qqMusicApi 8 commits | g_tk 三种硬编码值、签名常量、UA 全硬编码 |
| **R9** | i18n 翻译表 | `i18n.ts` 2592 行单文件 | M | G | i18n 22 commits | 翻译键随功能加，单文件膨胀 |
| **R10** | 快捷键定义 + 匹配 | `shortcuts.ts` 402 行 + useShortcuts 248 行 | M | G | shortcuts 7 commits + useShortcuts 多次改 | 默认键、平台差异、用户自定义三层未清晰分离 |
| **R11** | Auto-updater 流程 | `updater.ts` 139 行 | M | G | updater 新增 | 新功能，dev/prod 分支不对称 |
| **R12** | 渲染层 IPC 客户端 | `desktopAdapter.ts` 449 行 + preload 35 个方法 | M | G | desktopAdapter 27 + preload 20 | 方法持续增加，每个都是空检查样板 |

### 低频稳定（L/S）—— 不动

| ID | 关系 | 当前住所 | 备注 |
|----|------|---------|------|
| R13 | Track → LibrarySlot 隶属（tracks[] 容器） | types.ts | Schema 6 个月稳定 |
| R14 | LibrarySlot 双槽结构 | useLibrarySlots | 双槽概念稳定，只是切换逻辑乱（见 R2） |
| R15 | 持久化路径（userData/library.json 等） | electron/ipc/handlers.ts | 文件名稳定 |
| R16 | 主题 CSS 变量名 | themeManager | 命名稳定 |
| R17 | WebDAV HTTP verbs (PROPFIND/GET/PUT) | webdavHandlers | 协议稳定 |

---

## Step 2.5: 查现有（关键步骤，反过度设计）

**在外化任何东西之前，先问：现有代码是否已经覆盖了这个变化速率？**

| 异变关系 | 现有覆盖物 | 覆盖情况 | 行动 |
|---------|----------|---------|------|
| **R1 元数据解析三份重复** | metadataService 主线程版 + worker 版 + coverArtService 版 | **三份并存**，无共享 | ✅ 合并为共享模块（worker 通过 import 复用） |
| **R2 播放状态机** | usePlayback 已存在但与 slots 双源 | **半外化**，缺统一权威源 | 🔧 让 usePlayback 成为唯一权威，slots 派生 |
| **R3 存储双轨** | libraryStorage（IPC）+ indexedDBStorage（浏览器） | **Electron 模式只用前者** | ✂️ 在 Electron 模式下删 indexedDBStorage 的 library 调用，仅保留 cookie/metadata/webdav 元数据 |
| **R4 LibraryView 子模式** | 当前都挤在一个组件 | **完全未拆** | 🔧 抽 `useLibraryListViewModel` hook + 子组件 |
| **R5 App.tsx** | errorHandler.ts **完整定义但 0 处使用** | **现有未接通** | 🔧 **接通 errorHandler**，不要新建 |
| **R5 App.tsx 主题注入** | themeManager 单例已存在 | **现有半用** | 🔧 把 30+ setProperty 搬进 themeManager.applyTheme() |
| **R5 App.tsx QQ pipeline** | qqMusicApi 已封装 search/url/lyrics | **现有半用**，pipeline 编排未抽出 | 🔧 新建一个 `qqMusicPipeline.ts` 函数模块（不是类） |
| **R6 Cookie 校验** | cookieManager.validateCookie 存在但假成功 | **现有未完善** | 🔧 修语义（区分网络错误 vs cookie 失效） |
| **R7 WebDAV provider** | providerConfig.ts 已抽出 | **已外化** | ⏸️ **不动** |
| **R8 QQ API 常量** | 全硬编码 | **未外化** | 🔧 提到模块顶部 const 或配置 |
| **R9 i18n 翻译表** | 单文件 2592 行 | **未拆** | 🔧 按语言拆 `i18n/zh.ts` 等（零风险数据搬家） |
| **R10 快捷键** | shortcuts.ts + useShortcuts + shortcutManager | **三层都有**，但 useShortcuts 248 行手维护 15 个 ref | 🔧 抽 `useShortcutBinding(action, handler)` |
| **R12 IPC 客户端** | desktopAdapter 已包装 | **半用**，App.tsx 还在直接调 window.electron | 🔧 App.tsx 改走 desktopAdapter |

---

## Step 3: 按变化速率分组（"原子"识别）

| 原子 | 包含的实体 + 关系 | 共同的变化节奏 |
|------|----------------|---------------|
| **A. Track 数据骨架** | E1 Track + E6 Metadata schema + E2 LibrarySlot schema + R13 隶属 | L/S — 半年不动 |
| **B. 元数据解析** | R1（ID3/FLAC/MP4 三轨合并） | H/O — 反复修 bug |
| **C. 播放状态机** | E3 PlaybackContext + E8 AudioElement + R2 同步 | H/O — 跨 slot bug 反复 |
| **D. UI 视图骨架** | E17 ViewMode + TitleBar/Sidebar/Controls | M/O — UI 风格探索 |
| **E. 库视图内部** | R4（list/edit/category/search） | H/O — LibraryView 70 commits |
| **F. 状态中枢** | App.tsx（R5） | H/O — 最高频 |
| **G. 外部音源** | E9 Cookie + R8 QQ API + R6 校验 | M/G — 接入更多源 |
| **H. 远端文件** | E10 WebDAVConfig + R7 provider + useWebDAV | M/G — 加 provider |
| **I. 持久化** | R3（双轨存储） | H/O — 反复调 |
| **J. 偏好域** | E14 Theme + E15 Shortcut + E16 Settings + E18 Update | M/G — 缓慢加功能 |
| **K. 跨切（i18n / 错误处理 / 日志）** | R9 + errorHandler + logger | M/G — 横切关注点 |

---

## Step 4: 拆分行动表（按 ROI 排序，从最轻工具开始）

> **关键原则**：能用现有解决就不新建；新建优先函数 > hook > 接口 > 类。

| # | 行动 | 工具 | 类型 | ROI | 估时 | 风险 | 对应原子 |
|---|------|------|------|-----|------|------|---------|
| **1** | 接通现有 `errorHandler.ts`，替换 App.tsx 13 处 `try/catch + err: any + err.message` | **复用现有** | 文件已存在 | ⭐⭐⭐⭐⭐ | 1h | 极低 | F, K |
| **2** | 把 App.tsx 主题注入（30+ setProperty）搬到 `themeManager.applyTheme()` | **扩展现有** | 单例方法 | ⭐⭐⭐⭐⭐ | 1h | 低 | F, J |
| **3** | 删除 SettingsDialog.tsx (380) 和 LyricsOverlay.tsx (58) | **删死代码** | 删除 | ⭐⭐⭐⭐⭐ | 0.5h | 极低 | D |
| **4** | 合并 SearchBox.tsx 和 GlobalSearch.tsx 重复逻辑 → 抽 `useQQSearch()` hook | **抽取 hook** | 新建 1 个 hook | ⭐⭐⭐⭐ | 2h | 中（UI 改动） | D |
| **5** | 删除 `check-file-exists` IPC（与 `validate-file-path` 重复） | **删重复** | 删除 | ⭐⭐⭐⭐ | 0.5h | 低 | I |
| **6** | App.tsx 内联 QQ 音乐下载/上传 pipeline → `services/qqMusicPipeline.ts`（函数模块，不是类） | **抽取函数模块** | 新建 1 个文件 | ⭐⭐⭐⭐⭐ | 3h | 中 | F, G |
| **7** | metadataService + worker + coverArtService 三份解析合并 → `services/metadata/parsers/` 共享 + worker import 复用 | **合并** | 重构 | ⭐⭐⭐⭐⭐ | 1d | 中高（最易出 bug） | B |
| **8** | Electron 模式下移除 indexedDBStorage 的 library 调用（5 处）→ 保留 cookie/metadata/webdav 元数据持久化 | **整理双轨** | 部分删除 | ⭐⭐⭐⭐ | 2h | 中 | I |
| **9** | 修复 `validateSourcePath` Windows 失效（白名单只命中 `/Users`/`/home`） | **修 bug** | 修 | ⭐⭐⭐ | 1h | 低 | I |
| **10** | Cookie / WebDAV 密码从明文 → secret-storage 接口（最轻：electron safeStorage，不是新建加密层） | **接口抽象 + 最轻实现** | 新建 1 个接口 | ⭐⭐⭐ | 4h | 中（迁移数据） | G, H |
| **11** | LibraryView.tsx 1685 行 → 抽 `useLibraryListViewModel()` + 4 个子组件 | **拆分** | hook + 组件 | ⭐⭐⭐⭐ | 1d | 中高 | E |
| ~~**12**~~ | ~~i18n.ts 2592 行 → `i18n/zh.ts`/`en.ts`/...（纯数据搬家）~~ | **执行时再分析后撤销** | — | — | — | — | — |
| **13** | 抽 `useI18n()` / `useTheme()` hook，消除 18 个组件重复的 subscribe 套路 | **抽取 hook** | 新建 2 个 hook | ⭐⭐⭐ | 2h | 低 | K |
| **14** | App.tsx 直接调 `window.electron?.xxx` → 改走 `desktopAdapter`（约 6 处） | **复用现有** | 接通 | ⭐⭐⭐⭐ | 1h | 低 | F |
| **15** | 修 `cookieManager.validateCookie` 假成功（网络错误 vs cookie 失效分开） | **修语义** | 修 | ⭐⭐⭐ | 1h | 低 | G |
| **16** | 拆 useImport.ts 687 行 → 4 个入口共用 `processFiles` 核心 | **抽取** | 函数 | ⭐⭐⭐ | 2h | 中 | I |
| **17** | useShortcuts 248 行 15 ref → 抽 `useShortcutBinding(action, handler)` | **抽取 hook** | 新建 | ⭐⭐ | 2h | 中 | J |
| **18** | FocusMode.tsx 1112 行 → 拆 `useFocusModeCanvas` + `useLyricsSync` + 子组件 | **拆分** | hook + 组件 | ⭐⭐⭐ | 1d | 中高 | D |

**总估时：~5-6 个工作日**（不含 #7 和 #18 的高风险项验证）

---

## 执行期再分析（Re-analysis during execution）

实施过程中对行动项做的 DVA 二次校准。原表里有些项目只看了"代码量大"，没严格用变化速率判据。

### ~~#12 i18n 按语言拆文件~~ — **撤销**

**再分析依据**：i18n 当前是 **key-based** 结构（每个 key 内含 zh/en/ja/ko/de/fr）。变化速率证据：
- 加新 key：高频（最近 22 commits 多数是加 key）
- 加新语言：6 个月 0 次
- 谁翻译：用户本人

按语言拆 = 把"加 key"从改一处变成改 6 文件，**把同变的东西异化**——违反禁忌"不要把变化速率对齐的东西也外化"。

**结论**：i18n.ts 单文件大（2592 行）是审美问题，不是 DVA 问题。不拆。

### ~~#14 App.tsx 全部 6 处 window.electron 改走 desktopAdapter~~ — **部分撤销**

**再分析依据**：6 处中只有 2 个方法（`readFile` / `writeAudioMetadata`）已在 desktopAdapter 中。另外 4 个（`getQQMusicLyrics` / `fetchCoverBase64` / `downloadAndSave` / `onDownloadProgress`）若加进 desktopAdapter，是纯转发样板（无 fallback、无缓存、无类型增益）——**对 IPC 调用关系无速率变化**，纯属视觉一致性。

**结论**：仅接通 3 处（readFile 1 + writeAudioMetadata 2）。剩余 4 处随 #6 抽 qqMusicPipeline 时一起处理，那时是"搬移到新模块"而非"加转发样板"。

---

## 实施进度总览（执行批次追踪）

**分支**：`dva_refactor`
**当前 HEAD**：见 `git log` 最新提交
**净代码变化**：-638 行（重构净减）

### ✅ 已完成（第一、二批，共 12 项）

| # | 行动 | Commit | 净变化 |
|---|------|--------|--------|
| 1 | 接通 utils/errorHandler（App.tsx 内 2 处 try/catch + err: any） | `2861129` | -5 |
| 2 | 主题注入 50 行 useEffect → themeManager.applyCurrentTheme() | `2861129` | -45 |
| 3 | 删 SettingsDialog.tsx (380) + LyricsOverlay.tsx (58) 死代码 | `2861129` | -438 |
| 5 | 删 check-file-exists IPC（与 validate-file-path 字节重复） | `2861129` | -10 |
| 14 | App.tsx → desktopAdapter（部分：readFile + writeAudioMetadata ×2 = 3/6 处） | `2861129` | -5 |
| 15 | CookieStatus 改 discriminated union，修假成功语义（3 调用点同步更新） | `b84e675` | 见批次 |
| 13 | 抽 hooks/useServices.ts (useI18n + useTheme)，16 组件消除重复 subscribe 套路 | `b84e675` | -177 |
| 8 | 删 indexedDBStorage 3 个死方法（loadLibrary / getStorageEstimate / clearAll） | `ccd887d` | -50 |
| 6 | 抽 services/qqMusicPipeline.ts，App.tsx 减 169 行 | `ccd887d` | App.tsx -169 |
| 4 | 抽 hooks/useQQSearch.ts，SearchBox / GlobalSearch 各减 ~50 行 | `ccd887d` | -100 |
| 16 | useImport 抽 persistAfterImport，4 处重复 metadata+library 保存归一 | `5501bdb` | -2 |

### ❌ DVA 再分析后撤销（1 项）

| # | 行动 | 撤销原因 |
|---|------|---------|
| 12 | i18n.ts 按语言拆文件 | 当前 key-based 结构变化速率分析后判定为 DVA-correct。按语言拆会把同变的东西异化（每加一个 key 要改 6 个文件），违反"不要把变化速率对齐的东西也外化"。 |

### ⏸️ 未完成（第三批，高风险，留待后续）

| # | 行动 | 优先级 | 风险 | 备注 |
|---|------|--------|------|------|
| 7 | 元数据解析三轨合并（metadataService + worker + coverArtService） | ⭐⭐⭐⭐⭐ | **中高** | 三份近乎逐字符复制的解析代码（ID3/FLAC/Vorbis）合并为共享模块，worker 通过 import 复用。**最易出 bug，建议单独 PR + 充分手工测试**。 |
| 11 | 拆 LibraryView.tsx 1685 行 → useLibraryListViewModel hook + 4 子组件 | ⭐⭐⭐⭐ | **中高** | 列表 / 编辑模式 / 拖拽 / 分类视图 / debug 命令注册 各自独立。 |
| 18 | 拆 FocusMode.tsx 1112 行 → useFocusModeCanvas + useLyricsSync + 子组件 | ⭐⭐⭐ | **中高** | canvas RAF 动画 + 歌词同步 + 交互逻辑，动画时序敏感。 |
| 10 | Cookie / WebDAV 密码从明文 → secret-storage 接口 | ⭐⭐⭐ | **中** | 涉及已有数据迁移。最轻实现：electron safeStorage API。 |
| 9 | 修 validateSourcePath Windows 失效（白名单只命中 `/Users`/`/home`，跨盘符源文件被拒） | ⭐⭐ | 低 | 安全相关，bug 修复。 |
| 17 | 抽 useShortcutBinding(action, handler) 替代 useShortcuts 248 行 15 ref 模式 | ⭐⭐ | 中 | 纯样式优化，业务影响小。 |
| (新) | 拆 useImport.ts 4 入口共用核心（仅做了 persistAfterImport 抽取，批次处理 dedup/batch/UI update 未抽） | ⭐⭐ | 中 | 4 个入口仍有重复的 BATCH_SIZE/UI_UPDATE_BATCH/setImportProgress 逻辑。 |
| (新) | 清理 electron 主进程其他重复 / 命名误导（`select-folder` 实际是 openFile、`refresh-track-metadata` 名实不符） | ⭐ | 低 | 可在第三批顺带处理。 |

### 关键架构变化（已落实）

- **App.tsx**：802 → 633 行（-21%）。状态中枢职责收窄。
- **新增 hooks/useServices.ts**：i18n/theme 订阅的统一入口。
- **新增 hooks/useQQSearch.ts**：QQ 音乐搜索 + 本地/云端 filter 的统一入口。
- **新增 services/qqMusicPipeline.ts**：QQ 音乐下载/上传流水线，UI 通过 callbacks 注入。
- **themeManager**：applyTheme 从 private 改 public，新增 applyCurrentTheme()。
- **errorHandler**：从 0 处使用 → App.tsx 关键路径接通。
- **cookieManager.CookieStatus**：boolean → discriminated union，语义清晰。

### 验证状态

| 项 | 状态 | 说明 |
|----|------|------|
| TypeScript 编译（`tsc --noEmit`） | ✅ 全程通过 | 每批改动后都验证过 |
| 应用启动 | ✅ 已验证 | 用户确认能正常启动 |
| **功能回归测试** | ⚠️ **未验证** | **未跑过任何功能路径**：导入 / 播放 / 搜索 / WebDAV / QQ 下载上传 / 切语言 / 切主题。合并前必须手工跑一遍这些场景。 |

**风险点**（按可能受影响的概率排序）：
1. **Cookie 校验**（#15）：改变了 CookieStatus 类型，3 个调用点（CookieDialog / SettingsView / BrowseView）逻辑都改了，网络错误分支新加。需要测：正常 cookie / 过期 cookie / 断网。
2. **QQ 音乐下载/上传**（#6）：pipeline 抽出，依赖回调注入。需要测完整下载和上传流程。
3. **导入流程**（#16）：persistAfterImport 抽取。需要测 Electron 模式和 Web 模式分别能保存。
4. **useI18n/useTheme**（#13）：16 个组件的订阅模式改了。需要测切语言和切主题的响应。
5. **useQQSearch**（#4）：SearchBox 和 GlobalSearch 共享逻辑。需要测搜索结果展示。
6. **themeManager.applyCurrentTheme**（#2）：从内联 useEffect 搬入。需要测主题切换的 CSS 变量更新。

---

## Step 5: 验证

### Round 1（必须全过）

| 问题 | 验证方式 | 状态 |
|------|---------|------|
| 改一个需求能只动一处吗？ | 每个原子内的修改不外溢 | ⏳ 待重构后验证 |
| 改了 A 不会崩 B 吗？ | 重构后跑现有功能：导入/播放/搜索/WebDAV | ⏳ |
| 来了意料之外的变化，能兜住吗？ | 加新音源 / 加新 provider 试点 | ⏳ |

### Round 2（按项目阶段，**生产用户已存在**——从严）

| 问题 | 关注点 | 状态 |
|------|--------|------|
| 改这个模块需要动其他模块吗？ | F(状态中枢) 改了不该影响 B(解析) | ⏳ |
| 3 个月需求大改，能接着迭代还是重写？ | 看 R7 WebDAV provider 是否易加新 | ⏳ |
| 半年后看得懂吗？ | 拆完的 hook/服务命名清晰 | ⏳ |
| 改完能快速验证没改坏吗？ | 项目**无测试**——必须手工跑全部视图 | ⚠️ **当前短板** |

---

## 决策建议（推荐执行顺序）

**第一批（最低风险、最快收益，1 天）**：
- #1 接通 errorHandler（最反 DVA：定义了不用）
- #2 主题注入搬进 themeManager
- #3 删 SettingsDialog / LyricsOverlay
- #5 删 check-file-exists IPC
- #12 i18n 拆文件（纯数据搬家）
- #14 App.tsx 改走 desktopAdapter

**第二批（中等改动，2-3 天）**：
- #4 合并 SearchBox / GlobalSearch
- #6 抽 qqMusicPipeline
- #8 整理 indexedDBStorage
- #13 抽 useI18n / useTheme
- #15 修 cookie 校验语义
- #16 拆 useImport

**第三批（高风险，逐个验证，2-3 天）**：
- #7 元数据解析三轨合并（最易出 bug，单独 PR）
- #11 拆 LibraryView（UI 变化大）
- #18 拆 FocusMode（动画时序敏感）
- #10 secret-storage（涉及数据迁移）

**故意不做**：
- 不做完整 DDD 重构（违反禁忌 YAGNI）
- 不引入状态管理库（MobX/Redux）—— Context + hook 够用
- 不重写 IPC 层 —— 现有 preload + handler 模式 OK
- 不抽 Repository 模式 —— libraryStorage 已够用
- 不新建 ErrorBoundary 子类化体系 —— 现有单个够用

---

## 不在本次重构范围（明确 YAGNI）

- Tauri 移植（git 历史显示曾尝试后放弃，短期不动）
- 引入测试框架（独立任务，不混入重构）
- 引入 ESLint / Prettier（独立任务）
- 多账号 / 多 QQ Cookie（用户没需求）
- 跨设备同步（用户没需求）
