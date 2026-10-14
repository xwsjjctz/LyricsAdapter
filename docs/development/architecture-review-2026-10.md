# 架构评审与整改待办（2026-10）

基线：`dev` @ `d6cd43a`（v0.5.7-beta.1）。外部架构评审给出了 9 条问题，本文逐条对照代码核实，修正优先级和不成立的建议，并列出整改待办。待办完成后在本文勾选，不另建记录。

## 总体判断

外部评审的事实部分基本准确：数字和文件位置都对得上。需要修正的有三处：

- **优先级偏高**：插件隔离、状态层两项被定为 P0。实际上插件在文档中明确定位为“可信官方插件”；controller 作为唯一写入方也是 AGENTS.md 中的既定设计，不应推翻重来。
- **规模偏大**：旧 IPC 只剩两个调用方；“12 文件循环”中大部分边是类型引用，运行时真正的环只有一处。
- **一条建议会引入 bug**：开沙箱时把 `os.release()` 直接换成 `process.getSystemVersion()`。详见下文。

## 逐条核实

| # | 评审观点 | 核实结果 | 结论 |
|---|---|---|---|
| 1 | 插件在主进程无隔离 | 属实。`pluginRuntime.ts`、`musicPluginRegistry.ts` 用 `createRequire` 加载；`withDeadline` 挡不住同步死循环。`src/shared/pluginUpdate.ts` 已支持 `github` 和 `manifest` 两种第三方更新源 | 降为 P1。先做更新确认与来源锁定；开放第三方市场前再上 utilityProcess 隔离 |
| 2 | renderer 没有真正的状态层 | 属实。没有一个 `createContext`；198 个 `useEffect`；`playerStore.ts` 用 effect 把 volume/playbackMode 回写到 slot | 方向对，但要渐进做：先让 store 接管读取路径，写入仍只走 controller。曲库状态移到主进程等于重写，暂不做 |
| 3 | 分层倒置、循环依赖、无 lint | 属实。运行时环：`desktopAdapter → metadataService → libraryStorage → desktopAdapter`；`electron/services` 反向依赖 `electron/ipc/core` | 第一步处理，已完成，见下文 |
| 4 | 宿主写死 QQ/网易云 | 属实，`docs/music-source-plugins.md` 也承认 | 是否做，取决于是否开放第三方音乐源 |
| 5 | IPC 新旧两套 | 属实，但规模小：旧 `settings:*` 与 `userData:*` 只在 `libraryPersistenceRepository.ts` 和 `pluginTranslationStore.ts` 中使用 | 成本低，排第二步 |
| 6 | 沙箱未开 | 属实，注释给的理由不成立。设置面板窗口也是 `sandbox: false` | 建议本身有误，见下节 |
| 7 | 巨型文件缺测试 | 属实。`useWebDAV` 1203 行、`LibraryView` 1153 行、`useImport` 944 行 | 有边界检查兜底后再拆，先拆 `useWebDAV` |
| 8 | 共享代码放在 renderer 目录 | 属实，但大多数引用指向 `src/shared` 和 `src/types`，这本身没问题 | 用依赖规则约束，不搬目录 |
| 9 | 浏览器模式维护成本 | 25 处 `isDesktop()` 分支属实 | 待决定：浏览器模式是否还有用途 |

### 沙箱建议的修正

`os.release()` 返回 Darwin 内核版本（macOS 26 对应 `25.x`），`process.getSystemVersion()` 返回 macOS 产品版本（`26.0.0`）。`src/shared/macTitleBarLayout.ts` 和 `src/services/nativeContextMenu.ts` 都按 Darwin 主版本号判断，直接替换会让标题栏布局和原生右键菜单的判断出错。

正确做法：在主进程读取 `os.release()`，通过 `webPreferences.additionalArguments` 或同步 IPC 传给 preload。然后同时为主窗口和设置面板开启 `sandbox: true`，并在 macOS 和 Windows 上分别实测。

## 待办

### 1. 依赖边界检查（已完成）

- [x] 引入 `dependency-cruiser`，规则在 `.dependency-cruiser.cjs`：
  - 禁止运行时循环依赖（类型引用形成的环不算）；
  - `electron/` 只能引用 `src/` 中的 types、shared、domain、constants 和 locale JSON；
  - `src/` 不得引用 `electron/`；
  - 上述基础层不得反向依赖 renderer 其他层；
  - services 和 repositories 不得依赖 hooks、stores、controllers、viewmodels、components、commands；
  - hooks、stores、controllers、viewmodels 不得依赖 components 和 commands；
  - `electron/services` 不得依赖 `electron/ipc`。
- [x] `npm run deps:check` 加入 `npm run check` 首位。CI 的 `pr-check.yml` 通过 `npm run check` 自动覆盖。
- [x] 现存违规用基线 `.dependency-cruiser-known-violations.json` 记录。新增违规会让检查失败。修掉一条已知违规后，运行 `npm run deps:baseline` 缩小基线；**不得为放行新违规而重新生成基线**。
- [x] 修复 7 条违规：
  - 删除 `metadataService` 对 `libraryStorage` 的转导出，拆掉运行时环；`useImport` 改为直接引用 `libraryStorage`。
  - `electron/ipc/core/libraryCore.ts` 移到 `electron/services/libraryIndexFiles.ts`。它是纯文件 I/O，被 handler 和 persistence service 共用。
  - `streamProtocol.ts` 和 `domain/trackFactory.ts` 的在线音乐类型改从 `src/shared/onlineMusic` 引入。
  - `src/i18n/index.ts` 是 renderer 初始化代码，不属于共享层；主进程只引用 locale JSON，规则按此收窄。

基线中剩余的 11 条已全部修复，基线清空：

- [x] `trackMenuItems.ts` 与 `TrackMenuPosition` 移到 `src/domain/trackMenuItems.ts`（同时解决 nativeContextMenu、useLibraryTrackActions 的三条）。
- [x] 翻译偏好的外部状态下沉到 `src/services/pluginTranslationPreference.ts`，`stores/pluginTranslationStore.ts` 只保留 React 订阅；读写改走 typed `ipc.settings`。
- [x] `useSettingValue` 移到 `src/hooks`，`useFocusGlassControls` 移到 `src/hooks`。
- [x] `playerLayout.ts` 移到 `src/constants/playerLayout.ts`。
- [x] `SettingsSectionId` 统一从 `src/types/settingsPanel` 引用。
- [x] `PaletteCommand` 类型移到 `src/types/paletteCommand.ts`；`commands/` 仍属于 UI 组合层。

暂未写成规则：

- `components → services` 共 82 处。其中 logger、i18n 等调用是合理的，一刀切禁止会误伤。等 store 引入后再细化为“components 不得调用会修改状态的 service”。
- `stores → hooks`。现在的 store 本质上是组合 hook，等第 4 步引入真正的 store 后再定规则。

### 2. 下线旧 IPC（已完成）

- [x] adapter 的 `settings*`、`userData*`、`persistence*` 只走 typed `ipc.*`，删除对旧 preload 的回退和“原始值兼容”分支；收到非 `IpcResult` 的回复直接拒绝。`libraryPersistenceRepository` 通过 adapter 调用，无需改动。
- [x] `pluginTranslationStore` 已在第 1 步改走 `ipc.settings`。
- [x] 删除 preload 的 `settings*`、`userData*` 平铺方法，以及主进程 `settings:*`、`userData:*` 原始通道。
- [x] 删除无调用方的 typed 通道：`ipc:userData:save`、`ipc:userData:saveTracks`、`ipc:userData:getFilePath`、`ipc:download:audio`。
- [x] 删除无调用方的旧通道：`check-file-exists`、`save-local-library-backup`/`load-local-library-backup`（连同 `libraryHandlers.ts`）、`save-audio-file`、`save-audio-file-from-buffer`、`delete-audio-file`、`cleanup-orphan-audio`、`refresh-track-metadata`、`cleanup-orphan-covers`、`download-audio-file`、`save-file-to-path`，以及插件兼容别名 `qq-music-request`、`get-qq-music-url`、`get-qq-music-lyrics`、`netease-request`。其中多个是可写任意路径或删除文件的通道，删除同时缩小了攻击面。
- [x] 同步更新 `DesktopAPI`、`OnlineMusicElectronAPI`、`TypedElectronIPC` 类型、单元测试和 e2e 用例。

剩余的非 typed 通道（窗口控制、插件管理、扫码登录、元数据读写、封面、下载、更新）每个能力只有一条通道，不再是“双轨”。统一契约的工作见第 2b 步。

### 2b. 单一 IPC 契约（已完成）

- [x] `src/shared/ipcContract.ts` 声明全部 invoke、send 和事件通道的参数与结果类型。
- [x] 主进程只通过 `electron/ipc/ipcMainTyped.ts` 的 `handleIpc` / `onIpc` / `sendIpc` 注册和发送；preload 只通过内部的 `invoke` / `listen` / `send` helper 调用 `ipcRenderer`。
- [x] `window.electron` 的形状由 `src/shared/electronBridge.ts` 的 `ElectronBridge` 定义，preload `satisfies ElectronBridge`，`ElectronAdapter` 基于它实现，透传方法的类型直接引用它。编译器随即暴露两处已有漂移：`validateAllPaths` 被假定一定返回 `results`，`selectDownloadFolder` 漏了 `canceled`。
- [x] `UpdaterState` 移到 `src/shared/updater.ts`，主进程与 renderer 共用。
- [x] `useWindowControls` 改走 adapter，不再直接读 `window.electron`。
- [x] `test/electron/ipc/ipcContract.test.ts` 检查没有绕过 helper 的原始 IPC 调用，并确认每个契约通道都有主进程实现和 preload 出口。

### 3. 插件更新安全

- [x] 第三方来源（`github`、`manifest`）：绑定新来源、以及每次安装更新前，都由主进程弹出系统确认框，显示来源地址、版本变化和 SHA-256；默认取消，取消后不做任何改变。renderer 无法绕过。
- [x] 来源锁定：清单里的 `update` 只在首次安装时生效（原有行为），之后只有经用户确认的显式绑定能改变来源。
- [x] 文档说明第三方插件以宿主权限运行（`docs/plugins/updates.md`、`docs/music-source-plugins.md`）。
- [ ] 每个插件放进独立 `utilityProcess`，通过 MessagePort 做 RPC，SDK 接口保持不变。见第 7 步。

### 4. 渲染层状态（已完成）

- [x] `src/stores/createStore.ts`：基于 `useSyncExternalStore` 的最小外部 store，相同值不通知订阅者。
- [x] `src/stores/libraryState.ts`：曲库领域状态（四个 slot、`activeSlotId`、`viewSlot`）移出组件树，经 `LibraryStateProvider` 提供；`AppShell` 不再接收 `slots` / `activeTracks` / `viewSlot`，`LibraryView` 的选中项、滚动位置、过滤、数据源等 6 个 props 改为从 store 读取。
- [x] 写入仍只经 `useLibrarySlots` 与 controllers，保持 AGENTS.md 的所有权约定。`slotsRef` 及“下一次渲染前手动改 ref”的写法由 `getSlots()` 取代。
- [x] 删除 `playerStore` 用 effect 回写 volume / playbackMode 的写法：二者是全局状态，持久化快照把实时值写到 active slot，保存触发改为实时值。
- [x] 组合 hook（原 `stores/libraryStore`、`playerStore`、`importStore`、`uiStore`）移到 `src/hooks/`；新增依赖规则 `stores-hold-state-only`。
- [ ] 后续可继续：player 状态（`usePlayback`）同样移入外部 store，进一步减少 `Controls` / `FocusMode` 的 props。

### 5. 沙箱

- [ ] 主进程把 Darwin 版本传给 preload，删除 preload 中的 `require('node:os')`。
- [ ] 主窗口和设置面板开启 `sandbox: true`，更正注释，在 macOS 和 Windows 上实测。
- [ ] 评估把 WebDAV 凭据拼装（`authHeader`）移到主进程。

### 6. 后续，视产品方向而定

- [ ] 音乐源 ID 去硬编码，能力由插件 manifest 声明。
- [ ] 拆分 `useWebDAV`（HTTP、缓存、同步、UI 状态），并补测试。
- [ ] 决定浏览器模式的去留；保留的话，把差异收进 adapter。
