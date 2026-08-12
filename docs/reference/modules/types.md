# `types.ts` — 核心类型定义

## 文件概述

`types.ts` 是 LyricsAdapter 的**核心类型定义文件**，为整个应用提供共享的数据模型。它定义了音乐轨道、播放上下文、曲库插槽等核心实体的 TypeScript 类型，是其他所有模块的类型基础。

```typescript
// 位置：./types.ts
// 依赖：无（纯类型定义 + 工厂函数）
```

---

## 接口 (Interface)

### `Track`

```typescript
export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl?: string | undefined;
  lyrics?: string | undefined;
  syncedLyrics?: SyncedLyricLine[] | undefined;
  audioUrl: string;
  file?: File | undefined;
  available?: boolean | undefined;
  // Persistence fields for Electron
  filePath?: string | undefined;
  fileName?: string | undefined;
  fileSize?: number | undefined;
  lastModified?: number | undefined;
  addedAt?: string | undefined;
  playCount?: number | undefined;
  lastPlayed?: string | undefined;
  // WebDAV fields
  source?: 'local' | 'webdav' | undefined;
  webdavPath?: string | undefined;
  cdnUrl?: string | undefined;
  cdnUrlExpiry?: number | undefined;
}
```

**说明：** 应用中**最核心的数据模型**，代表一首音乐轨道。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 唯一标识，通常由 `filePath` 或 `webdavPath` 派生 |
| `title` | `string` | 歌曲标题 |
| `artist` | `string` | 艺术家 |
| `album` | `string` | 专辑 |
| `duration` | `number` | 时长（秒） |
| `coverUrl` | `string?` | 封面 URL，可以是 `blob:`、`cover://` 或 `http(s)://` |
| `lyrics` | `string?` | 纯文本歌词 |
| `syncedLyrics` | `SyncedLyricLine[]?` | 同步歌词（LRC 格式） |
| `audioUrl` | `string` | 音频 URL，通常是 `blob:` 或 CDN URL |
| `file` | `File?` | 浏览器端持有的 File 对象 |
| `available` | `boolean?` | 文件是否可用 |
| `filePath` | `string?` | Electron 环境下的文件系统路径 |
| `fileName` | `string?` | 文件名（含扩展名） |
| `fileSize` | `number?` | 文件大小（字节） |
| `lastModified` | `number?` | 文件最后修改时间戳 |
| `addedAt` | `string?` | 添加到曲库的时间（ISO 8601） |
| `playCount` | `number?` | 播放次数 |
| `lastPlayed` | `string?` | 最后播放时间 |
| `source` | `'local'\|'webdav'?` | 来源：本地文件或 WebDAV 远程 |
| `webdavPath` | `string?` | WebDAV 路径 |
| `cdnUrl` | `string?` | WebDAV CDN 加速 URL |
| `cdnUrlExpiry` | `number?` | CDN URL 过期时间戳 |

---

### `SyncedLyricLine`

```typescript
export interface SyncedLyricLine {
  time: number; // in seconds
  text: string;
}
```

**说明：** 同步歌词的一行，包含时间戳和歌词文本。

| 字段 | 类型 | 说明 |
|------|------|------|
| `time` | `number` | 时间点（秒） |
| `text` | `string` | 歌词文本 |

---

### `PlaybackContext`

```typescript
export interface PlaybackContext {
  trackIndex: number;
  trackId?: string;
  currentTime: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  isPlaying: boolean;
}
```

**说明：** 播放上下文快照，用于持久化保存播放状态。注意：这是**旧格式**，在 `useLibrarySlots` 中已被 `LibrarySlot` 替代。

| 字段 | 类型 | 说明 |
|------|------|------|
| `trackIndex` | `number` | 当前音轨索引 |
| `trackId` | `string?` | 当前音轨 ID |
| `currentTime` | `number` | 播放位置（秒） |
| `volume` | `number` | 音量 (0-1) |
| `playbackMode` | `'order'\|'shuffle'\|'repeat-one'` | 播放模式 |
| `isPlaying` | `boolean` | 是否正在播放 |

---

### `LibrarySlot`

```typescript
export interface LibrarySlot {
  id: 'local' | 'cloud';
  tracks: Track[];
  currentTrackIndex: number;
  currentTime: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  scrollPosition: number;
  filterType: 'default' | 'album' | 'artist';
  categorySelection: string | null;
}
```

**说明：** 曲库插槽，应用维护**两个独立插槽**（local/cloud），各自保存完整的播放上下文。这是双播放上下文模式的核心数据结构。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `'local' \| 'cloud'` | 插槽标识 |
| `tracks` | `Track[]` | 该插槽的曲库列表 |
| `currentTrackIndex` | `number` | 当前播放索引 |
| `currentTime` | `number` | 当前播放位置 |
| `volume` | `number` | 音量 |
| `playbackMode` | `'order'\|'shuffle'\|'repeat-one'` | 播放模式 |
| `scrollPosition` | `number` | 列表滚动位置 |
| `filterType` | `'default'\|'album'\|'artist'` | 过滤类型 |
| `categorySelection` | `string\|null` | 选中的分类 |

---

### `MetaJson`

```typescript
export interface MetaJson {
  title: string;
  artist: string;
  album: string;
  duration: number;
  fileSize: number;
  fileName: string;
  lastModified: string;
  lyrics?: string;
  syncedLyrics?: SyncedLyricLine[];
  coverUrl?: string;
  coverHash?: string;
  coverMime?: string;
}
```

**说明：** 元数据 JSON 格式，用于曲库持久化序列化时的结构。

---

## 枚举 (Enum)

### `ViewMode`

```typescript
export enum ViewMode {
  PLAYER = 'player',
  LYRICS = 'lyrics',
  BROWSE = 'browse',
  METADATA = 'metadata',
  SETTINGS = 'settings',
  THEME = 'theme'
}
```

**说明：** 应用视图模式枚举，控制主界面展示哪个视图。

| 值 | 含义 |
|----|------|
| `PLAYER` | 播放器主界面 |
| `LYRICS` | 歌词视图 |
| `BROWSE` | 浏览视图 |
| `METADATA` | 元数据编辑视图 |
| `SETTINGS` | 设置页面 |
| `THEME` | 主题选择页面 |

---

## 函数 (Function)

### `createEmptySlot`

```typescript
export function createEmptySlot(id: 'local' | 'cloud'): LibrarySlot
```

- **说明：** 创建空的 `LibrarySlot`，提供合理的默认值
- **参数：**
  - `id: 'local' | 'cloud'` — 插槽标识
- **返回值：** `LibrarySlot` — 填充默认值的插槽对象
  - `currentTrackIndex: -1`（无选中歌曲）
  - `volume: 0.5`（默认音量 50%）
  - `playbackMode: 'order'`（顺序播放）
  - `scrollPosition: 0`
  - `filterType: 'default'`
  - `categorySelection: null`
- **调用处：** `hooks/useLibrarySlots.ts` 初始化时使用

---

## 设计要点

1. **所有字段可选（`?`）设计**：除了 `id`、`title`、`artist`、`album`、`duration`、`audioUrl` 外的字段都标记为可选，保证在元数据不完整时仍能构造 Track 对象
2. **双来源模型**：通过 `source: 'local' | 'webdav'` 区分本地文件和云端文件，`filePath` 和 `webdavPath` 分别各自携带路径信息
3. **详细的持久化字段**：`filePath`、`fileName`、`fileSize`、`lastModified`、`addedAt` 等字段专为 Electron 文件系统持久化设计
4. **Track 标识规则**：`id` 由路径派生（`filePath` 或 `webdavPath`），不单独生成 UUID
