# `hooks/useLibrarySlots.ts` — 双曲库插槽管理 Hook

## 文件概述

这是 LyricsAdapter **最独特的架构设计**——双播放上下文 Hook。维护两个独立的 `LibrarySlot`（`local` 和 `cloud`），每个插槽保存完整的播放状态（曲库列表、当前播放索引、音量、播放模式、过滤状态等）。切换插槽时自动保存/恢复播放上下文。

```typescript
// 位置：./hooks/useLibrarySlots.ts
// 依赖：types、logger
```

---

## 类型别名 (Type Alias)

```typescript
type SlotId = 'local' | 'cloud';
```

## 接口 (Interface)

### `SlotPersistenceData`

```typescript
interface SlotPersistenceData {
  currentTrackIndex: number;
  currentTime: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  scrollPosition: number;
  filterType: 'default' | 'album' | 'artist';
  categorySelection: string | null;
}
```

- **说明：** 插槽持久化数据（不含 `tracks` 数组），保存插槽的"非轨道状态"

### `PersistedSlotState`

```typescript
interface PersistedSlotState {
  localSlot?: SlotPersistenceData | Partial<SlotPersistenceData>;
  cloudSlot?: SlotPersistenceData | Partial<SlotPersistenceData>;
  activeSlotId?: SlotId;
  activeDataSource?: SlotId;         // 旧字段兼容
  localPlaybackContext?: PlaybackContext;  // 旧字段兼容
  cloudPlaybackContext?: PlaybackContext;  // 旧字段兼容
}
```

- **说明：** 完整的持久化状态，用于跨会话恢复
- **兼容旧格式：** `localPlaybackContext` / `cloudPlaybackContext` 和 `activeDataSource` 是旧版格式，逐步迁移中

---

## Hook 函数 (Hook)

### `useLibrarySlots`

```typescript
export function useLibrarySlots() {
```

#### 状态 (State)

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `slots` | `Record<SlotId, LibrarySlot>` | 两个插槽的完整状态 |
| `activeSlotId` | `SlotId` | 当前激活的插槽 ID |

#### 派生值 (Derived Values)

| 变量名 | 来源 | 说明 |
|--------|------|------|
| `activeSlot` | `slots[activeSlotId]` | 当前激活插槽 |
| `activeTracks` | `activeSlot.tracks` | 当前激活插槽的曲库列表 |
| `activeTrackIndex` | `activeSlot.currentTrackIndex` | 当前播放索引 |

#### 方法 (Functions)

##### 插槽切换

| 方法 | 签名 | 说明 |
|------|------|------|
| `switchTo` | `(slotId: SlotId) => void` | 切换到指定插槽 |

##### 通用更新

| 方法 | 签名 | 说明 |
|------|------|------|
| `updateSlot` | `(slotId, updater: (slot) => slot) => void` | 对指定插槽执行更新器函数 |

##### 属性设置（针对 activeSlot）

| 方法 | 签名 | 说明 |
|------|------|------|
| `setActiveTrackIndex` | `(index: number \| ((prev) => number)) => void` | 设置当前索引，支持函数式更新 |
| `setActiveTracks` | `(tracks \| ((prev) => Track[])) => void` | 设置曲库列表 |
| `setActiveCurrentTime` | `(time: number) => void` | 设置当前播放时间 |
| `setActiveVolume` | `(volume: number) => void` | 设置音量 |
| `setActivePlaybackMode` | `(mode \| ((prev) => mode)) => void` | 设置播放模式（顺序/随机/单曲循环） |
| `setActiveScrollPosition` | `(position: number) => void` | 设置列表滚动位置 |
| `setActiveFilterType` | `(filterType: 'default'\|'album'\|'artist') => void` | 设置过滤类型 |
| `setActiveCategorySelection` | `(selection: string\|null) => void` | 设置分类选择 |

##### 云插槽专用

| 方法 | 签名 | 说明 |
|------|------|------|
| `loadCloudTracks` | `(tracks: Track[]) => void` | 全量替换 cloud 插槽的曲库 |
| `mergeCloudTracks` | `(added, removedIds, updated) => void` | 增量合并 cloud 曲库 |

**`mergeCloudTracks` 的智能合并逻辑：**
1. 从 `removedIds` 中过滤出要删除的条目
2. **例外：** 如果当前播放的 track 被标记为删除，保留但标记 `available: false`
3. 应用 `updated` 中的更新
4. 添加 `added` 中的新条目（去重）

##### 持久化

| 方法 | 签名 | 说明 |
|------|------|------|
| `getPersistenceData` | `() => PersistedSlotState` | 提取两个插槽的状态用于保存 |
| `restoreFromPersistence` | `(data, tracksFromDisk) => void` | 从持久化数据恢复状态 |

**`restoreFromPersistence` 的恢复逻辑：**
1. 检测数据格式（新版 slot 格式 vs 旧版 legacy 格式）
2. 恢复 `activeSlotId`
3. 先从磁盘加载的 tracks 填充到 local 插槽
4. 用 `??` 操作符合并持久化状态与默认状态

---

## 模块级函数 (Module-level Function)

### `migrateFromLegacyFormat`

```typescript
function migrateFromLegacyFormat(
  data: PersistedSlotState
): {
  localSlot: Partial<SlotPersistenceData>;
  cloudSlot: Partial<SlotPersistenceData>;
  activeSlotId: SlotId;
}
```

- **说明：** 将旧版持久化格式（PlaybackContext）迁移到新版 slot 格式
- **旧版数据来源：**
  - `localPlaybackContext` / `cloudPlaybackContext`（PlaybackContext 格式）
  - 顶层字段（`currentTrackIndex`、`currentTime` 等）
  - `activeDataSource` / `libraryDataSource`（旧版插槽标识）
- **迁移策略：**
  1. 优先使用 `localPlaybackContext`
  2. 回退到顶层字段
  3. 使用 ActiveSlotId 的多种旧字段名兼容旧版本

---

## Hook 返回值

```typescript
return {
  slots, activeSlotId, activeSlot, activeTracks, activeTrackIndex,
  switchTo, updateSlot,
  setActiveTrackIndex, setActiveTracks, setActiveCurrentTime,
  setActiveVolume, setActivePlaybackMode, setActiveScrollPosition,
  setActiveFilterType, setActiveCategorySelection,
  loadCloudTracks, mergeCloudTracks, updateLocalTracks,
  getPersistenceData, restoreFromPersistence,
};
```

---

## 设计要点

1. **双插槽架构**：`local` 和 `cloud` 各自独立的播放上下文（曲库、索引、音量、播放模式等），切换插槽时 `isPlaying` 置为 `false` 防止自动播放
2. **Immutable 更新**：所有状态更新使用 spread 操作符创建新对象，从不直接修改 `prev`
3. **分类/过滤状态持久化**：每个插槽保存 `scrollPosition`、`filterType`、`categorySelection`，切换回来时恢复到之前浏览位置
4. **智能增量合并**：`mergeCloudTracks` 对云端曲库变更采用智能合并，当前播放中的曲目即使被删除也保留
5. **旧格式迁移**：`migrateFromLegacyFormat` 支持从旧版 `PlaybackContext` 格式到 `LibrarySlot` 格式的平滑迁移
6. **使用 `??` 而非 `||`**：恢复持久化状态时使用空值合并操作符（`??`），避免将 `0` 或 `false` 这样的有效值视为缺失
