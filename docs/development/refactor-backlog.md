# 重构待办

本文是重构工作唯一的现行记录：执行规则、已核实仍未解决的问题，以及历史文档的位置。完成一项后从“待办”中删除，并在提交信息里说明；不另建记录。

## 执行规则

沿用 2026-07 起的渐进式重构约定（原文见[重构路线图](../archive/refactor-roadmap.md)第 10、12 节）：

1. **迁移优先**：先原样移动代码，再在后续改动中优化。同一次提交不同时移动代码、重新设计逻辑、修改 UI 和数据结构。
2. **一次只改一个架构边界**，例如只调整 controller 边界时不顺带改存储、IPC 或 WebDAV。
3. **发现无关问题时记到本文**，写明位置、问题和暂不处理的原因，不顺手修改。
4. **不做大重写**：不重写播放器，不为重构更换状态管理库，不在没有证据时引入状态机框架。

## 待办

条目于 2026-11-18 对照 `dev` 源码核实。

### 曲库写入收进 controller

导入、云同步、在线上传和文件重载直接持有 `useLibrarySlots` 的写入函数（`useImport`、`useLibraryCloudSync`、`useOnlineMusicIntegration`、`useLibraryActions`），没有经过 `useLibraryController`。现状和例外清单见[架构概览](../architecture/overview.md#曲库状态的写入方)与 AGENTS.md。

暂不处理的原因：涉及导入、WebDAV 和在线下载三条流程，需要逐条迁移并补测试。新增曲库变更应直接放进 controller。

### 导入流程依赖播放状态

`useImport` 的参数包含 `isPlaying`、`volume`、`playbackMode`、`persistedTimeRef` 和 `getPersistenceData`，导入为自行持久化而读取播放状态。随上一条迁移时，持久化应交回 `useLibraryLoad` 的写队列。

### controller 的 `updateSlot` 类型过宽

`useLibraryController.ts` 与 `usePlayerController.ts` 的 options 把 `updateSlot` 声明为 `(slotId: SlotId, updater: (slot: any) => any) => void`，丢失了 `LibrarySlot` 的类型检查。改为 `(slot: LibrarySlot) => LibrarySlot` 时需要逐个修正调用处的返回值。

### `usePlayerController` 依赖数组不完整（原 RF-001、RF-002）

- `handleTrackSelect` 用到 `setRestoreTime`、`shouldAutoPlayRef`，未列入依赖。
- `handleSearchNavigate` 用到 `setRestoreTime`、`shouldAutoPlayRef`、`setViewSlot`，未列入依赖。

这些值是 setter、ref 或稳定回调，当前不会产生过期闭包；补全依赖属于行为无关的整理。

### 播放状态移入外部 store

曲库状态已移入 `stores/libraryState.ts`，播放状态仍在 `usePlayback` 内，`Controls`、`FocusMode` 仍通过 props 接收。可参照曲库状态的做法渐进迁移读取路径。

### `AppShell` 仍接收曲库视图的零散 props

云同步和歌单浏览已经通过 viewmodel 交给 `AppShell`，但 `pendingSlotLocate`、`handleSlotLocatePrepared`、`handleSlotContentReady`、`handleLibraryScrollPositionChange`、`handleCategoryChange` 和 `libraryContentRef` 仍逐个传入。它们属于列表的定位和滚动机制，可以合并为一个视图对象。

### 元数据解析重复实现

`services/metadata/metadataService.ts` 的主线程 parser 与 `services/metadata/metadataWorker.ts` 各有一份 MP3/FLAC/M4A 解析实现，修改解析行为时需要同步两处。

### 依赖规则尚未覆盖 components → services

components 直接调用 services 的地方中，logger、i18n、通知等是合理的，一刀切禁止会误伤。可以细化为“components 不得调用会修改状态的 service”后写入 `config/dependency-cruiser.cjs`。

### 需要在真实环境中实测

- 插件 utilityProcess 隔离：在打包后的应用中运行 `electron.music-plugins.spec.ts`、`electron.plugin-platform.spec.ts`。
- 主窗口和设置面板启用 `sandbox: true` 后，分别在 macOS 与 Windows 上实测。

### 按设计保留：`player.audioRef`（原 RF-010）

`PlayerViewModel` 仍把 `audioRef` 作为唯一出口交给需要逐帧计时的界面。完全封装需要在播放引擎中加入时间订阅接口，属于播放器重写范围。只有播放时序成为主要 bug 来源时再评估。

## 历史文档

以下文档已完成或被本文取代，移入 [`archive/`](../archive/)，仅用于追溯：

- [重构计划](../archive/refactor-plan.md)（2026-08，Phase 0–7 诊断与计划）
- [渐进式重构路线图](../archive/refactor-roadmap.md)（2026-08，目标分层与执行规则原文）
- [重构待办 RF-001 – RF-011](../archive/refactor-backlog-2026-09.md)（2026-09，逐条记录）
- [架构评审与整改待办](../archive/architecture-review-2026-10.md)（2026-10，依赖边界、IPC 契约、插件隔离、状态层、沙箱）
