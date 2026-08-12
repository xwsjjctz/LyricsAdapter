# `services/libraryStorage.ts` — 曲库持久化存储

## 文件概述

提供音乐库的**持久化存储服务**，通过 `DesktopAPI` 与 Electron 主进程通信，实现曲库数据的读写、验证和防抖保存。

```typescript
// 位置：./services/libraryStorage.ts
// 依赖：types、desktopAdapter、logger
```

---

## 接口 (Interface)

### `LibraryData`

```typescript
export interface LibraryData {
  songs: Track[];
  settings: LibrarySettings;
}
```

- **说明：** 曲库数据格式（旧版，仍保留兼容）

### `LibraryIndexSong`

```typescript
export interface LibraryIndexSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  lyrics?: string;
  syncedLyrics?: { time: number; text: string }[];
  coverUrl?: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  lastModified?: number;
  addedAt?: string;
  playCount?: number;
  lastPlayed?: string | null;
  available?: boolean;
  source?: 'local' | 'webdav';
  webdavPath?: string;
}
```

- **说明：** 曲库索引中的单曲格式，与 `Track` 类型基本相同但独立定义，避免循环依赖

### `LibraryIndexData`

```typescript
export interface LibraryIndexData {
  songs: LibraryIndexSong[];
  cloudSongs?: LibraryIndexSong[];
  settings: LibrarySettings;
}
```

- **说明：** 曲库索引格式，支持双来源（local + cloud）

| 字段 | 类型 | 说明 |
|------|------|------|
| `songs` | `LibraryIndexSong[]` | 本地曲库列表 |
| `cloudSongs` | `LibraryIndexSong[]?` | 云端（WebDAV）曲库列表 |
| `settings` | `LibrarySettings` | 应用设置 |

### `LibrarySettings`

```typescript
export interface LibrarySettings {
  volume?: number | undefined;
  autoScroll?: boolean | undefined;
  theme?: string | undefined;
  currentTrackIndex?: number | undefined;
  currentTrackId?: string | undefined;
  currentTime?: number | undefined;
  isPlaying?: boolean | undefined;
  playbackMode?: 'order' | 'shuffle' | 'repeat-one' | undefined;
  libraryDataSource?: 'local' | 'cloud' | undefined;
  localCurrentTrackId?: string | undefined;
  cloudCurrentTrackId?: string | undefined;
  activeDataSource?: 'local' | 'cloud' | undefined;
  localPlaybackContext?: PlaybackContext | undefined;
  cloudPlaybackContext?: PlaybackContext | undefined;
  localSlot?: Omit<LibrarySlot, 'id' | 'tracks'> | undefined;
  cloudSlot?: Omit<LibrarySlot, 'id' | 'tracks'> | undefined;
  activeSlotId?: 'local' | 'cloud' | undefined;
  [key: string]: any;
}
```

- **说明：** 曲库设置，包含大量可选字段以兼容不同版本的持久化数据
- **`[key: string]: any`**：宽松的索引签名，用于兼容旧版数据格式中的额外字段
- **双插槽支持**：`localSlot` / `cloudSlot` 存储各插槽的非轨道状态

### `ValidationResult`

```typescript
export interface ValidationResult {
  id: string;
  exists: boolean;
}
```

- **说明：** 路径验证结果，标识每个 track 的文件是否存在

---

## 类 (Class)

### `LibraryStorageService`

#### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `saveTimer` | `NodeJS.Timeout \| null` | 防抖定时器句柄 |
| `saveDelay` | `number` | 防抖延迟（1000ms） |

#### 方法

##### `clearSaveTimer`

```typescript
clearSaveTimer(): void
```

- **说明：** 清除防抖定时器

##### `loadLibrary`

```typescript
async loadLibrary(): Promise<LibraryIndexData>
```

- **说明：** 从磁盘加载曲库
- **流程：**
  1. 获取 `DesktopAPI`，若不可用返回 `{ songs: [], settings: {} }`
  2. 优先调用 `loadLibraryIndex`，回退到 `loadLibrary`
  3. 成功则返回曲库数据，失败打日志并返回空曲库
- **返回值：** 绝不 throw，失败时返回空曲库

##### `saveLibrary`

```typescript
async saveLibrary(library: LibraryIndexData): Promise<boolean>
```

- **说明：** 保存曲库到磁盘
- **流程：**
  1. 获取 `DesktopAPI`，不可用返回 `false`
  2. 优先调用 `saveLibraryIndex`，回退到 `saveLibrary`
  3. 成功返回 `true`，失败打日志并返回 `false`

##### `saveLibraryDebounced`

```typescript
saveLibraryDebounced(library: LibraryIndexData): void
```

- **说明：** 防抖保存，延迟 1 秒执行实际保存操作
- **用途：** 在频繁触发保存的场景下（如删除多首歌）合并写入操作
- **逻辑：** 若已有待执行的保存，清除并重新计时

##### `validateFilePath`

```typescript
async validateFilePath(filePath: string): Promise<boolean>
```

- **说明：** 验证单个文件路径是否存在
- **返回值：** `boolean`（API 不可用时返回 `false`）

##### `validateAllPaths`

```typescript
async validateAllPaths(songs: Track[]): Promise<ValidationResult[]>
```

- **说明：** 批量验证所有文件路径
- **返回值：** `ValidationResult[]`（API 不可用时所有标为 `exists: false`）

##### `getAppDataPath`

```typescript
async getAppDataPath(): Promise<string | null>
```

- **说明：** 获取 Electron 应用数据目录路径
- **返回值：** `string | null`

---

## 导出实例 (Exported Instance)

```typescript
export const libraryStorage = new LibraryStorageService();
```

---

## 设计要点

1. **防抖写入**：`saveLibraryDebounced` 使用 1 秒防抖，避免快速连续操作导致频繁 IO
2. **优雅降级**：所有方法在 API 不可用时返回安全默认值（空数组、`false`、`null`），绝不 throw
3. **双曲库支持**：`LibraryIndexData` 包含 `songs` 和 `cloudSongs`，对应 local 和 cloud 两个插槽
4. **版本兼容**：`LibrarySettings` 中大量可选字段 + 索引签名，确保新旧版本数据格式兼容
5. **错误处理**：所有异常被 `try-catch` 捕获并打日志，不影响应用正常运行
