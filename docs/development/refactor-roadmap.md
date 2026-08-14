# LyricsAdapter 渐进式重构路线图

## 1. 文档目标

本文档用于指导 LyricsAdapter 在保持现有功能稳定的前提下进行渐进式架构重构。

本轮重构不以“大规模重写”为目标，而是解决随着功能持续增加出现的以下问题：

* `AppWorkspace` 承担过多业务编排职责；
* UI 层直接接触底层状态结构；
* 播放控制逻辑分散在多个 Hook、Callback 和 Effect 中；
* Library Slot 可以从多个位置直接修改；
* 新旧 UI 同时依赖底层业务实现；
* 在线音乐、本地音乐、WebDAV 音乐之间存在重复的播放编排逻辑；
* 持久化模型同时承担历史兼容与当前状态存储职责；
* AI 辅助开发过程中容易出现局部修改合理、整体架构继续恶化的问题。

重构必须遵循以下原则：

1. 不进行全量重写；
2. 每个阶段必须可以独立合并；
3. 每次重构不得同时进行大规模 UI 改版；
4. 优先迁移现有逻辑，不优先重新实现；
5. 重构前后用户行为必须保持一致；
6. 每个阶段完成后必须保证应用可以正常构建和运行；
7. 新功能开发不得绕过已经建立的 Controller 边界。

---

# 2. 目标架构

最终目标不是建立复杂的企业级分层架构，而是形成适合单人长期维护的轻量领域架构。

目标结构：

```text
UI Layer
    │
    ▼
ViewModel Layer
    │
    ▼
Controller Layer
    │
    ├── Player Controller
    ├── Library Controller
    ├── Online Playback Controller
    └── Playlist Controller
    │
    ▼
State / Domain Layer
    │
    ├── Player Store
    ├── Library Store
    └── UI Store
    │
    ▼
Service Layer
    │
    ├── Library Storage
    ├── Metadata Service
    ├── Online Music Provider
    ├── WebDAV Service
    └── Desktop Adapter
    │
    ▼
Electron IPC / Protocol Layer
```

各层职责如下。

## UI Layer

负责：

* 展示数据；
* 收集用户输入；
* 调用 ViewModel 或 Controller 暴露的操作；
* 管理纯视觉状态。

禁止：

* 直接修改 Slot；
* 自行组织播放流程；
* 自行决定在线歌曲如何转换为 Track；
* 直接操作播放时序状态；
* 直接访问 Electron IPC；
* 复制业务数据转换逻辑。

---

## ViewModel Layer

负责将底层领域状态转换成 UI 可以直接使用的数据。

例如：

```ts
interface PlayerViewModel {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackMode: PlaybackMode;

  toggle(): void;
  next(): void;
  previous(): void;
  seek(time: number): void;
  setVolume(volume: number): void;
}
```

ViewModel 不应该：

* 实现复杂业务流程；
* 直接访问 IPC；
* 保存持久化数据；
* 实现 Provider 网络请求。

---

## Controller Layer

Controller 是本轮重构的核心。

Controller 负责：

* 接收用户意图；
* 编排多个 Store；
* 调用 Service；
* 管理跨领域流程；
* 隐藏底层状态修改细节。

例如：

```text
用户点击在线歌曲
        │
        ▼
OnlinePlaybackController.playSong()
        │
        ├── 获取/构建 Track
        ├── 更新 Online Slot
        ├── 调用 PlayerController
        └── 异步加载歌词
```

UI 不需要知道这个过程。

---

# 3. Phase 1：建立 Player Controller

## 3.1 目标

建立统一播放控制入口。

完成后：

* UI 不需要知道如何切换 Slot；
* UI 不需要知道 `restoreTime`；
* UI 不需要操作自动播放相关 Ref；
* 在线、本地、WebDAV、Playlist 播放最终经过统一播放入口。

建议新增：

```text
controllers/
└── usePlayerController.ts
```

---

## 3.2 第一批迁移范围

第一阶段只迁移：

```text
handleTrackSelect
handlePlayPlaylist
基础 Slot 切换播放逻辑
```

暂时不要同时迁移：

```text
在线歌词缓存
下载
上传
缓存清理
Library Import
Library Persistence
```

必须控制第一次重构的影响范围。

---

## 3.3 Player Controller 推荐接口

```ts
interface PlayerController {
  playTrack(slotId: SlotId, index: number): void;

  playTrackById(
    slotId: SlotId,
    trackId: string
  ): void;

  playPlaylist(
    tracks: Track[],
    startIndex: number
  ): void;

  toggle(): void;

  pause(): void;

  next(): void;

  previous(): void;

  seek(time: number): void;
}
```

具体接口允许根据现有代码调整，但必须保持一个原则：

> UI 表达用户意图，Controller 负责完成播放状态迁移。

---

## 3.4 迁移策略

禁止直接重新实现播放逻辑。

应该按照以下步骤执行：

### Step 1

从 `AppWorkspace` 中识别完整播放流程。

例如：

```text
保存当前 Slot 播放时间
→ 修改目标 Slot currentTrackIndex
→ 设置 restoreTime
→ switchTo(targetSlot)
→ 设置 autoplay intent
→ 设置 playing state
```

### Step 2

将流程原样迁移至 Controller。

### Step 3

让原来的 handler 变成简单代理：

```ts
const handleTrackSelect = (index: number) => {
  playerController.playTrack(viewSlot, index);
};
```

### Step 4

确认行为一致后，再删除旧逻辑。

---

## 3.5 Phase 1 完成标准

满足以下条件才算完成：

* `AppWorkspace` 不再直接组织基础播放状态迁移；
* 播放一首 Slot 内歌曲只需要一次 Controller 调用；
* Playlist 播放通过 Controller 进入统一流程；
* 新旧 UI 播放行为保持一致；
* 本地播放正常；
* WebDAV 播放正常；
* 在线 Playlist 播放正常；
  -上一首/下一首行为没有变化；
  -应用关闭后的播放位置恢复行为没有变化。

---

# 4. Phase 2：建立 Library Controller

## 4.1 目标

限制 Library Slot 的修改入口。

当前 Library Store 可以继续保留，但业务层不应该到处直接调用：

```ts
updateSlot(...)
```

目标是逐步变成：

```ts
libraryController.removeTracks(...)
libraryController.reorderTracks(...)
libraryController.updateTrack(...)
libraryController.importTracks(...)
```

建议新增：

```text
controllers/
└── useLibraryController.ts
```

---

## 4.2 推荐接口

```ts
interface LibraryController {
  removeTrack(
    slotId: SlotId,
    trackId: string
  ): Promise<void>;

  removeTracks(
    slotId: SlotId,
    trackIds: string[]
  ): Promise<void>;

  reorderTracks(
    slotId: SlotId,
    fromIndex: number,
    toIndex: number
  ): void;

  updateTrack(
    slotId: SlotId,
    track: Track
  ): void;

  switchViewSlot(
    slotId: SlotId
  ): void;
}
```

Import 可以在第二轮加入，不建议第一时间把所有 Library 行为一起迁移。

---

## 4.3 删除流程重点

删除歌曲不是简单的：

```ts
tracks.filter(...)
```

必须明确区分：

### 从 Library 移除

只删除索引。

### 删除 App 管理的音频文件

可能涉及：

* 文件删除；
* symlink 删除；
* Library Index 更新；
* Cover Cache 清理；
* Metadata Cache 清理。

### Cloud Track 删除

可能涉及：

* WebDAV 文件；
* WebDAV Metadata；
* Cover Cache；
* IndexedDB。

Controller 必须明确区分这些语义。

禁止建立一个含义模糊的：

```ts
deleteTrack()
```

建议使用：

```ts
removeFromLibrary()
deleteManagedTrack()
deleteCloudTrack()
```

或者使用显式 options：

```ts
removeTrack(trackId, {
  deleteSource: false
})
```

---

## 4.4 Phase 2 完成标准

* UI 不直接调用 `updateSlot` 完成业务操作；
* 删除行为集中；
* 批量删除行为集中；
* 重排逻辑集中；
* Track Metadata 更新有明确入口；
* AppWorkspace 中 Library 操作逻辑明显减少。

---

# 5. Phase 3：Online Music Domain 收敛

## 5.1 目标

把以下业务从 `AppWorkspace` 移出：

```text
QQ Music
NetEase Music
Online Stream
Online Playlist
Online Lyrics
Download
Upload to WebDAV
```

建议结构：

```text
controllers/
├── useOnlinePlaybackController.ts
└── usePlaylistController.ts
```

---

## 5.2 Online Playback Controller

建议接口：

```ts
interface OnlinePlaybackController {
  playSong(
    song: OnlineSong,
    source: OnlineSource
  ): Promise<void>;

  downloadSong(
    song: OnlineSong,
    source: OnlineSource
  ): Promise<void>;

  uploadSong(
    song: OnlineSong,
    source: OnlineSource
  ): Promise<void>;
}
```

Controller 内负责：

```text
OnlineSong
    ↓
normalizeOnlineTrack()
    ↓
Track
    ↓
Online Slot
    ↓
Player Controller
```

---

## 5.3 建立统一数据转换函数

目前应避免新旧 UI 分别执行：

```ts
{
  songmid: song.songmid,
  title: song.songname,
  artist: song.singer?.map(...),
  album: song.albumname,
  coverUrl: song.coverUrl
}
```

建议建立：

```text
domain/
└── trackFactory.ts
```

例如：

```ts
export function onlineSongToTrack(
  song: OnlineSong,
  source: OnlineSource
): Track
```

所有在线歌曲进入播放器之前必须经过统一转换。

这样未来 Provider 字段发生变化时，只修改一个位置。

---

## 5.4 Playlist Controller

负责：

```text
打开 Playlist
加载歌曲列表
转换 Track
装载 Playlist Slot
设置起始 Index
触发播放
维护 Playlist 播放上下文
```

推荐接口：

```ts
interface PlaylistController {
  openPlaylist(
    source: OnlineSource,
    playlistId: string
  ): Promise<void>;

  playPlaylist(
    source: OnlineSource,
    songs: OnlineSong[],
    startIndex: number
  ): Promise<void>;
}
```

---

## 5.5 Lyrics Prefetch

Playlist 当前存在滑动窗口歌词加载策略。

该逻辑暂时不要重新设计算法。

只进行位置迁移。

建议：

```text
hooks/
└── usePlaylistLyricsWindow.ts
```

职责：

```text
监听 playlist currentTrackIndex
→ 计算 current ± 1
→ 加载缺失歌词
→ 清理窗口之外歌词
```

不要把这个逻辑放进 UI。

---

# 6. Phase 4：建立 App ViewModel

## 6.1 目标

解除新 UI 与旧 UI 对底层业务实现的直接依赖。

目标：

```text
                  AppViewModel
                  /          \
                 /            \
          NewUxShell       LegacyShell
```

而不是：

```text
                   AppWorkspace
          /       /      |       \
       Slot   Player   Import   Online
        │        │        │        │
        └────────两套 UI───────────┘
```

---

## 6.2 推荐结构

```text
viewmodels/
├── useAppViewModel.ts
├── usePlayerViewModel.ts
├── useLibraryViewModel.ts
└── useOnlineViewModel.ts
```

不要求一次全部建立。

建议首先建立：

```text
usePlayerViewModel
useLibraryViewModel
```

---

## 6.3 Player ViewModel

示例：

```ts
interface PlayerViewModel {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackMode: PlaybackMode;

  togglePlay(): void;
  next(): void;
  previous(): void;
  seek(time: number): void;
  changeVolume(volume: number): void;
  togglePlaybackMode(): void;
}
```

新旧 UI 都使用相同接口。

---

## 6.4 Library ViewModel

示例：

```ts
interface LibraryViewModel {
  tracks: Track[];
  currentTrackId?: string;
  currentTrackIndex: number;

  selectTrack(index: number): void;
  removeTrack(id: string): void;
  removeTracks(ids: string[]): void;
  reorder(from: number, to: number): void;
  updateTrack(track: Track): void;
}
```

UI 不需要知道：

```text
updateSlot
setActiveTracks
current slot implementation
persistence implementation
```

---

## 6.5 Audio Element 特殊说明

`audioRef` 不应该长期暴露给普通 UI 组件。

建议最终形成：

```text
Audio Engine
    ↑
Player Controller
    ↑
Player ViewModel
    ↑
UI
```

但这一部分属于高风险改动。

Phase 4 初期允许暂时保留现有 `audioRef` 传递方式。

不要为了追求理论上的完美架构，一次性重写 Audio Element 生命周期。

---

# 7. Phase 5：持久化模型版本化

## 7.1 当前问题

当前持久化配置同时包含：

* 历史字段；
* 当前 Slot；
* Playback Context；
* UI Persistence；
  -兼容字段。

长期继续扩展会增加：

* 恢复逻辑复杂度；
* 字段冲突风险；
* Migration 难度；
* AI 修改错误概率。

---

## 7.2 目标模型

建议引入：

```ts
interface LibraryIndexV2 {
  version: 2;

  tracks: {
    local: PersistedTrack[];
    cloud: PersistedTrack[];
    online: PersistedTrack[];
    playlist: PersistedTrack[];
  };

  slots: {
    local: PersistedSlotState;
    cloud: PersistedSlotState;
    online: PersistedSlotState;
    playlist: PersistedSlotState;
  };

  player: {
    activeSlotId: SlotId;
    volume: number;
    playbackMode: PlaybackMode;
  };

  ui: {
    playlistsView?: PlaylistsViewPersistence;
  };
}
```

实际结构可以根据现有实现调整。

重点不是完全按照该示例，而是：

> 数据必须有明确版本。

---

## 7.3 Migration Layer

新增：

```text
services/
└── libraryMigration.ts
```

提供：

```ts
migrateLibraryData(raw: unknown): LibraryIndexV2
```

流程：

```text
读取 JSON
    ↓
检测 version
    ↓
旧格式 Migration
    ↓
当前 Domain Model
```

Storage Service 不再承担大量兼容判断。

---

# 8. Phase 6：拆 Electron IPC Handler

该阶段优先级低于前五个阶段。

当前 IPC Handler 按 register function 进行了逻辑分类，但仍集中在较大的文件中。

建议逐步拆分：

```text
electron/ipc/
├── fileHandlers.ts
├── libraryHandlers.ts
├── coverHandlers.ts
├── downloadHandlers.ts
├── metadataHandlers.ts
├── windowHandlers.ts
└── registerHandlers.ts
```

`registerHandlers.ts` 只负责：

```ts
registerFileHandlers();
registerLibraryHandlers();
registerCoverHandlers();
registerDownloadHandlers();
registerMetadataHandlers();
registerWindowHandlers();
```

注意：

该阶段只进行文件组织调整。

不要同时：

* 修改 IPC channel name；
* 修改 preload API；
* 修改 renderer 调用方式；
* 修改数据协议。

---

# 9. 测试策略

LyricsAdapter 当前阶段不需要追求极高测试覆盖率。

优先测试高风险状态流。

## 第一优先级

```text
playTrack
switchSlot
nextTrack
previousTrack
repeat-one
shuffle
restore playback state
```

## 第二优先级

```text
remove track
batch remove
reorder
library persistence
migration
```

## 第三优先级

```text
onlineSongToTrack
playlist loading
lyrics parsing
```

不建议优先给纯 UI 组件补大量 Snapshot Test。

---

# 10. 每个 Phase 的执行规则

每个阶段必须遵循：

## Rule 1：迁移优先

先移动现有代码，再优化代码。

禁止：

```text
移动代码
+
重新设计逻辑
+
修改 UI
+
修改数据结构
```

在同一个 PR 中同时进行。

---

## Rule 2：一次只改变一个架构边界

例如 Phase 1：

只建立：

```text
UI → Player Controller → Existing Playback Logic
```

不要同时修改：

```text
Storage
IPC
Provider
Metadata
WebDAV
```

---

## Rule 3：每个 PR 必须回答

```text
1. 本 PR 解决什么架构问题？
2. 哪些行为必须保持不变？
3. 状态所有权发生了什么变化？
4. 新增了什么边界？
5. 哪些技术债明确留到后续 Phase？
```

---

## Rule 4：禁止 Opportunistic Refactor

Agent 在执行任务时，如果发现其他问题：

应该记录到：

```text
docs/development/refactor-backlog.md
```

而不是顺手修改。

格式：

```md
## RF-001

Location:
hooks/usePlayback.ts

Problem:
播放时序由多个 Ref 协调，可能适合显式状态机。

Reason not fixed now:
当前 Phase 只负责 Controller Boundary，不修改 Playback Engine。
```

---

# 11. 推荐执行顺序

推荐严格按照以下顺序：

```text
Phase 0
Architecture Documentation
Agent Rules
已完成

        ↓

Phase 1
Player Controller

        ↓

Phase 2
Library Controller

        ↓

Phase 3
Online Music Domain

        ↓

Phase 4
ViewModel Boundary
New UI / Legacy UI Decoupling

        ↓

Phase 5
Persistence Schema Versioning

        ↓

Phase 6
Electron IPC Organization
```

---

# 12. 不应该做的事情

当前阶段禁止以下行为。

## 不要重写整个播放器

现有播放系统已经支持：

* Local；
* WebDAV；
* QQ Music；
* NetEase Music；
* Playlist；
  -播放状态恢复。

全面重写风险远大于收益。

---

## 不要为了重构立即更换状态管理库

当前问题的核心不是 React State、Zustand 或 Redux 的选择。

核心问题是：

```text
状态修改入口过多
业务编排位置不明确
UI 知道太多底层结构
```

换状态库不会自动解决这些问题。

---

## 不要立即引入复杂状态机框架

Playback 当前存在隐式状态机特征，但第一阶段应该先通过 Controller 建立边界。

只有在 Controller 建立后，仍然确认播放时序是主要 Bug 来源时，才评估是否需要显式状态机。

---

## 不要同时重构新 UI 和旧 UI

新旧 UI 当前仍然需要共存。

正确顺序：

```text
建立 Controller
        ↓
建立 ViewModel
        ↓
两套 UI 使用相同接口
        ↓
确认新 UI 功能完整
        ↓
删除 Legacy UI
```

而不是：

```text
一边重构业务
一边重写 UI
一边删除旧组件
```

---

# 13. 最终完成状态

当本轮重构完成时，LyricsAdapter 应该达到以下状态：

```text
AppWorkspace
```

只负责：

* 初始化 Controller；
* 初始化 ViewModel；
  -选择 Shell；
  -应用级生命周期装配。

业务行为：

```text
UI
 ↓
ViewModel
 ↓
Controller
 ↓
Store / Service
 ↓
Electron
```

新增功能时，开发者首先能够回答：

```text
这个功能属于哪个 Domain？

它读取什么状态？

它通过哪个 Controller 修改状态？

它是否需要 Service？

UI 是否只是表达用户意图？
```

如果这些问题可以快速回答，说明本轮重构已经达到了目标。

本次重构的最终目标不是获得“完美架构”，而是降低单人维护 LyricsAdapter 的认知负担，让新增功能不再依赖理解整个应用的全部控制流。
