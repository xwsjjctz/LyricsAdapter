# 重构待办清单（Refactor Backlog）

本文件记录在重构过程中发现、但**当前 Phase 不修复**的问题（遵循 [重构路线图](./refactor-roadmap.md) Rule 4：禁止 Opportunistic Refactor）。每条记录位置、问题、暂不修复的原因。

---

## RF-001

Location:
`src/controllers/usePlayerController.ts` — `handleTrackSelect`

Problem:
`useCallback` 依赖数组为 `[viewSlot, activeSlotId, selectTrack, updateSlot, switchTo, setIsPlaying, audioRef, markTrackSwitch]`，但函数体内还用到了 `setRestoreTime` 与 `shouldAutoPlayRef`。二者分别是 useState setter 和稳定 ref，行为上不会因此产生 stale closure，但依赖列表不完整，违反 exhaustive-deps 约定。

Reason not fixed now:
当前 Phase 只负责把播放编排迁入 Player Controller 边界，不修改任何既有行为（roadmap Rule 1：迁移优先）。此问题在迁移前就存在于 `AppWorkspace`，按「原样迁移」原则保留，待 Player Controller 稳定后再统一补全依赖。

---

## RF-002

Location:
`src/controllers/usePlayerController.ts` — `handleSearchNavigate`

Problem:
`useCallback` 依赖数组为 `[activeSlotId, viewSlot, localTracks, cloudTracks, selectTrack, audioRef, updateSlot, switchTo, setIsPlaying]`，但函数体内还用到了 `setRestoreTime`、`shouldAutoPlayRef`、`setViewSlot`。同样属于依赖列表不完整（与 RF-001 同类问题）。

Reason not fixed now:
同 RF-001：迁移前既有问题，本 Phase 不改行为，原样保留。

---

## RF-003

Location:
`src/controllers/usePlayerController.ts` — `playOnlineSong` adapter

Problem:
该 adapter 合并了原 `AppWorkspace` 两处 `onOnlineStreamPlay` 调用点的 OnlineSong→Track 归一化逻辑。原 NewUxShell 版本条件性包含 `coverUrl`（`...(song.coverUrl ? {...} : {})`），原 SearchBox 版本恒包含 `coverUrl`（可能为 `undefined`）。合并后统一采用条件性包含。对最终 Track 而言两者行为等价（`coverUrl: undefined` 与缺省 key 都会回落到占位封面），但属于一次微小的逻辑收敛而非纯搬迁。

Reason not fixed now:
Phase 1 收尾时为消除重复归一化逻辑而合并，行为等价、风险极低。若后续发现封面相关回归，可回退为两套 adapter。记录于此以备追溯。

---

## RF-004 ✅ 已解决（Player Controller openOnlinePlaylist, 2026-07-08）

`handleOpenOnlinePlaylist` 已迁入 `usePlayerController.openOnlinePlaylist`。
保留记录以追溯。

---

---

## RF-005

Location:
项目根 `.gitignore`

Problem:
仍残留 `src/KgmWasm/build`、`src/KgmWasm/*.js`、`src/KgmWasm/*.wasm`、`src/QmcWasm/build`、`src/QmcWasm/*.js`、`src/QmcWasm/*.wasm` 等条目，但这些目录在当前源码中并不存在（应为历史遗留）。

Reason not fixed now:
本次重构聚焦目录搬迁 + Player Controller 边界，清理 `.gitignore` 属于无关改动，遵循「一次只改一个架构边界」原则留待后续。

---

## RF-006

Location:
`src/controllers/useLibraryController.ts` — `removeTrack` / `removeTracks`

Problem:
删除 API 当前沿用 `(trackId, deleteFile = false)` 布尔签名（迁移自 AppWorkspace）。roadmap §4.3 建议拆成显式语义方法：
- `removeFromLibrary(trackId)`：只删索引
- `deleteManagedTrack(trackId)`：删文件 + 索引 + 封面/元数据缓存
- `deleteCloudTrack(trackId)`：涉及 WebDAV 文件 / 元数据 / IndexedDB

当前 `deleteFile` 布尔无法区分「cloud track 删除」与「local 删文件」的语义差异，含义模糊。

Reason not fixed now:
Phase 2 严格遵循「迁移优先」（Rule 1），不改 API 形状以保持 UI prop 契约不变。语义拆分属于重新设计，留待 Phase 2 稳定后或引入 ViewModel（Phase 4）时统一处理。

---

## RF-007

Location:
`src/components/AppShell.tsx` — MetadataView 的 `onUpdateTrack`

Problem:
NewUxShell / LibraryView 的 `onUpdateTrack` 已迁入 `libraryController.updateTrack`（作用于 `viewSlot`）。但 MetadataView 的 `onUpdateTrack` 仍用 `setActiveTracks(prev => prev.map(...))`，作用于 **active slot** 而非 viewSlot。两者语义不同（active vs view），同一 prop 名 `onUpdateTrack` 行为不一致。

Reason not fixed now:
MetadataView 进入条件是 `viewMode === METADATA`，此时 viewSlot 与 activeSlot 通常是同一个（库视图），所以现实里行为通常等价。但严格来说 active≠view 时会更新错 slot。强行纳入 controller 的 viewSlot 版 `updateTrack` 会改变 active≠view 时的行为。遵循 Rule 1（不改行为），保留原样，待 Phase 4（ViewModel）统一 updateTrack 语义时一并处理。Controller 已在注释里标注此差异。

---

## RF-008 ✅ 已解决（全量 adapter 迁移, 2026-07-08）

renderer 业务代码不再直调 `window.electron`。`ElectronAdapter` 现实现 `FullDesktopAPI = DesktopAPI & OnlineMusicElectronAPI`，所有在线音乐通道（qqMusicRequest/neteaseRequest/getQQMusicLyrics/getQQMusicUrl/downloadAndSave/downloadAudioFile/fetchCoverBase64/on-offDownloadProgress/QR 登录五件套）都经 `getDesktopAPI()` 访问，且保留 `OnlineMusicElectronAPI` 里的富返回类型。迁移覆盖 qqMusicApi、neteaseMusicApi、qrLogin、cookieManager、useOnlineMusicIntegration、BrowseView、MetadataEditorPopup、MetadataEditPanel。仅剩 desktopAdapter.ts（adapter 自身）和 index.tsx（启动读 platform）引用 window.electron。「renderer 必须走 adapter」规则现已全仓成立。保留记录以追溯。

---

## RF-009 ✅ 已解决（cookie 同步收敛, 2026-07-08）

QQ/NetEase cookie→主进程同步原散落在 3 处（AppWorkspace 启动同步、SettingsView 登录后、useOnlineMusicSettings 登录后），且都直调 `window.electron?.setOnlineCookie`。已收敛为单一 `syncOnlineCookiesToMain(source?)` 服务（`services/cookieManager.ts`），并通过新增的 `DesktopAPI.setOnlineCookie` adapter 方法走 adapter。3 处调用点全部改用该服务。保留记录以追溯。

---

## RF-010 ⏸️ 按设计保留（audioRef 经 PlayerViewModel 单一出口, 2026-07-08）

Phase 4 PlayerViewModel 把 `audioRef` 作为逃生舱暴露（roadmap §6.5 明确允许 slice 1 这么做）。所有 UI 消费者（NewUxShell / Controls / FocusMode）现在统一从 `player.audioRef` 取，不再各自从 store 直接拿。

**为什么不完全封装**：FocusMode 的 requestAnimationFrame 歌词滚动循环（`FocusMode.tsx:142-176`）需要 ~60fps sub-frame 计时，React 的 `currentTime` state（throttled）无法满足。完全封装需要在 `usePlayback`（播放引擎）内加 `subscribeTime(callback)` 订阅 API——这属于 engine 重写，roadmap §12 明确禁止在当前轮重写播放器。因此保留 `player.audioRef` 单一出口作为终态，直到播放时序成为主要 bug 源时再评估。

---

## RF-011 ✅ 已解决（Online/Import ViewModel，2026-08-30）

`useOnlineViewModel` 和 `useImportViewModel` 已建立，`AppContent` 把两个面向 UI 的对象交给 `AppShell`，不再逐字段透传 Online/Import props。`onClearOrphanCache` 仍属于应用级组合逻辑，不纳入 ViewModel。保留记录以追溯。
