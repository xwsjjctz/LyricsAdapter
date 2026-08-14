# `hooks/useLibraryActions.ts` — 曲库操作 Hook

## 文件概述

封装曲库的**增删改操作**：删除单曲、批量删除、重新加载文件。处理删除时的资源清理（Blob URL、封面缓存、IndexedDB 元数据）和当前播放索引的修正。

```typescript
// 位置：./hooks/useLibraryActions.ts
// 依赖：types、desktopAdapter、indexedDBStorage、metadataCacheService、coverArtService、logger
```

---

## 接口 (Interface)

### `UseLibraryActionsOptions`

```typescript
interface UseLibraryActionsOptions {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentTrackIndex: number;
  setCurrentTrackIndex: (index: number | ((prev: number) => number)) => void;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  createTrackedBlobUrl: (blob: Blob | File) => string;
  revokeBlobUrl: (blobUrl: string) => void;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
}
```

---

## Hook 函数 (Hook)

### `useLibraryActions`

```typescript
export function useLibraryActions({...}: UseLibraryActionsOptions) {
```

#### 方法

##### `cleanupOrphanAudio`

```typescript
const cleanupOrphanAudio = useCallback(async (_remainingTracks: Track[]) => void)
```

- **说明：** 清理孤立音频文件
- **当前实现：** **No-op**（应用在 path-only 模式下运行，文件属于用户，应用不管理物理文件）
- **参数：** `_remainingTracks` — 保留的曲目列表（参数名以下划线开头表示未使用）
- **旧版行为：** 删除不再在曲库中的物理音频文件（已废弃）

##### `handleRemoveTrack`

```typescript
const handleRemoveTrack = useCallback(async (trackId: string) => void)
```

- **说明：** 删除单首曲目
- **流程：**
  1. 从 `tracks` 中过滤掉指定 ID 的曲目
  2. **如果曲库变空：**
      - 停止播放（`audio.pause()` + `audio.src = ''`）
      - 重置 `isPlaying = false`、`currentTrackIndex = -1`
      - 释放 Blob URL（音频和封面）
  3. **如果删除的是当前播放曲目：**
      - 索引左移（`max(0, currentTrackIndex - 1)`）
  4. **如果删除的曲目在当前曲目前面：**
      - 索引减 1
  5. 释放被删除曲目的 Blob URL
  6. 异步清理封面缓存和 IndexedDB 元数据
  7. 调用 `cleanupOrphanAudio`（当前 no-op）

**索引修正规则：**

| 情况 | 新索引 |
|------|--------|
| 曲库变空 | `-1` |
| 删除了当前曲目之前的曲目 | `currentTrackIndex - 1` |
| 删除了当前曲目本身 | `min(currentTrackIndex, newLength - 1)` |
| 删除了之后的曲目 | 不变 |

**Blob URL 清理条件：** 只有 URL 以 `blob:` 开头才调用 `revokeBlobUrl`

##### `handleRemoveMultipleTracks`

```typescript
const handleRemoveMultipleTracks = useCallback(async (trackIds: string[]) => void)
```

- **说明：** 批量删除多首曲目
- **流程：**
  1. 先遍历释放所有被删除曲目的 Blob URL（音频和封面）
  2. 批量删除封面缩略图（通过 `DesktopAPI.deleteCoverThumbnail`）
  3. 批量删除 IndexedDB 元数据（`indexedDBStorage.deleteMetadata`）
  4. 过滤掉指定 ID 的曲目
  5. 修正当前播放索引：计算"在当前曲目前被删除的曲目数"并减去
  6. 若所有曲目被删除完成，重置播放状态

**索引修正逻辑：**
```
removedBeforeCurrent = 被删除ID中索引 < 当前索引 的数量
newIndex = prevIndex - removedBeforeCurrent
// 边界修正
if (newIndex >= newLength) newIndex = max(0, newLength - 1)
if (newIndex < 0) newIndex = 0
```

##### `handleReloadFiles`

```typescript
const handleReloadFiles = useCallback(async () => void)
```

- **说明：** 重新加载文件（修复标记为 `available: false` 的曲目）
- **使用场景：** 用户将移动过的音频文件重新选择到对应位置
- **流程：**
  1. 打开系统文件选择对话框（`desktopAPI.selectFiles()`）
  2. 对每个选中的文件，**按文件名匹配**曲库中 `available: false` 的曲目
  3. 调用 `desktopAPI.parseAudioMetadata` 解析新文件的元数据
  4. 尝试将封面保存到磁盘（`saveCoverThumbnail`），失败则回退到 Blob URL
  5. 更新 `metadataCacheService` 中的缓存
  6. 更新曲目信息并标记 `available: true`

---

## Hook 返回值

```typescript
return {
  handleRemoveTrack,
  handleRemoveMultipleTracks,
  handleReloadFiles
};
```

---

## 设计要点

1. **Path-only 模式**：不再管理用户文件，删除只清理应用内部的缓存和索引
2. **索引精准修正**：批量删除时精确计算被移除曲目对当前播放索引的影响
3. **资源的完整清理**：删除时释放 Blob URL（音频 + 封面）、清理封面磁盘缓存、删除 IndexedDB 元数据
4. **`blob:` URL 安全释放**：只有以 `blob:` 开头的 URL 才调用 `revokeBlobUrl`，避免释放第三方 URL
5. **格式兼容**：`setCurrentTrackIndex` 同时支持直接值和函数式更新，与 `usePlayback` 的接口兼容
6. **匹配策略**：`handleReloadFiles` 按**文件名**而非 ID 匹配，因为移动文件会导致路径变化
