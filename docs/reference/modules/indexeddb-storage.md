# `services/indexedDBStorage.ts` — IndexedDB 存储服务

## 文件概述

基于 `idb` 库封装 IndexedDB，提供异步、大容量的本地存储。支持 metadata、settings、library、webdavMetadata、webdavFileListSnapshot 五个对象存储空间。包含数据验证以防止恶意数据注入。

```typescript
// 位置：./services/indexedDBStorage.ts
// 依赖：idb、dataValidator、logger、constants/config
```

---

## 接口 (Interface)

### `LyricsAdapterDB extends DBSchema`

```typescript
interface LyricsAdapterDB extends DBSchema {
  metadata: { key: string; value: MetadataEntry };
  webdavMetadata: { key: string; value: WebdavMetadataEntry };
  library: { key: string; value: LibraryData | LibraryIndexData };
  settings: { key: string; value: string };
  webdavFileListSnapshot: { key: string; value: SnapshotEntry };
}
```

**说明：** IndexedDB 数据库的 schema 定义，包含 5 个 Object Store：

| Store | Key | Value | 用途 |
|-------|-----|-------|------|
| `metadata` | trackId | 元数据 | 本地曲目元数据缓存 |
| `webdavMetadata` | filePath | WebDAV 元数据 | 云端文件元数据 |
| `library` | `'main'` | 曲库数据 | 浏览器模式下的曲库持久化 |
| `settings` | 任意 key | `string` | 设置项 |
| `webdavFileListSnapshot` | filePath | 文件信息 | WebDAV 文件列表快照 |

---

## 类 (Class)

### `IndexedDBStorageService`

#### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `db` | `IDBPDatabase<LyricsAdapterDB> \| null` | 数据库连接实例 |
| `initialized` | `boolean` | 是否已初始化 |

#### 方法

##### 初始化和连接

| 方法 | 说明 |
|------|------|
| `initialize()` | 打开/创建数据库，执行迁移 |
| `ensureInitialized()` | 确保数据库已初始化 |
| `close()` | 关闭数据库连接 |

**`initialize` 迁移流程（版本 1 → 4）：**

| 版本 | 变更 |
|------|------|
| v1 | 创建 `metadata`、`library`、`settings` |
| v2 | 删除 `covers` store |
| v3 | 创建 `webdavMetadata` |
| v4 | 创建 `webdavFileListSnapshot` |

---

##### 元数据操作 (6 个)

| 方法 | 签名 | 说明 |
|------|------|------|
| `getMetadata` | `(songId: string): Promise<ValidatedMetadata \| null>` | 获取单曲元数据，含验证 |
| `setMetadata` | `(songId: string, metadata: any): Promise<void>` | 设置元数据，含验证 |
| `deleteMetadata` | `(songId: string): Promise<void>` | 删除单曲元数据，含验证 |
| `getAllMetadata` | `(): Promise<Record<string, ValidatedMetadata>>` | 获取所有元数据，批量验证 |
| `clearMetadata` | `(): Promise<void>` | 清空所有元数据 |

**`getMetadata` 的验证流程：**
1. `validateSongId(songId)` — 检查 song ID 合法性（防注入）
2. 从 IndexedDB 读取
3. `validateMetadata(metadata)` — 校验元数据结构
4. 无效则删除该条目并返回 null

**`getAllMetadata` 的批量验证：**
- 遍历所有条目，用 `validateMetadataMap` 批量验证
- 记录被过滤的无效条目数量

---

##### WebDAV 元数据操作 (5 个)

| 方法 | 说明 |
|------|------|
| `getWebdavMetadata(filePath)` | 获取 WebDAV 文件元数据 |
| `setWebdavMetadata(filePath, metadata)` | 保存 WebDAV 文件元数据 |
| `getAllWebdavMetadata()` | 获取所有 WebDAV 元数据 |
| `clearWebdavMetadata()` | 清空所有 WebDAV 元数据 |

---

##### WebDAV 文件列表快照 (3 个)

| 方法 | 说明 |
|------|------|
| `getFileListSnapshot()` | 获取文件列表快照（用于增量同步） |
| `setFileListSnapshot(snapshot)` | 保存文件列表快照 |
| `clearFileListSnapshot()` | 清空快照 |

**用途：** 记录 WebDAV 目录下所有文件的大小和修改时间，下次同步时可以快速检测变更

---

##### 曲库操作 (2 个)

| 方法 | 说明 |
|------|------|
| `loadLibrary()` | 从 IndexedDB 加载曲库（**已废弃**，仅浏览器模式使用） |
| `saveLibrary(library)` | 保存曲库到 IndexedDB（**已废弃**，仅浏览器模式使用） |

**废弃说明：** Electron 模式使用 `libraryStorage.ts` 通过 IPC 写入文件系统

---

##### 设置操作 (3 个)

| 方法 | 说明 |
|------|------|
| `getSetting(key)` | 获取设置值 |
| `setSetting(key, value)` | 设置值 |
| `deleteSetting(key)` | 删除设置 |

---

##### 工具方法 (2 个)

| 方法 | 说明 |
|------|------|
| `getStorageEstimate()` | 获取存储使用量/配额（调用 navigator.storage.estimate） |
| `clearAll()` | 清空所有数据（仅 metadata） |

---

## 导出实例 (Exported Instance)

```typescript
export const indexedDBStorage = new IndexedDBStorageService();
```

---

## 设计要点

1. **`idb` 库封装**：使用 `idb` 库（`openDB`）而非原生 IndexedDB API，提供类型安全和更简洁的 Promise 语法
2. **级别迁移**：支持数据库 schema 版本迁移，从 v1 到 v4，处理旧版本兼容
3. **数据验证**：所有 metadata 写入/读取都经过 `validateMetadata` 校验，防止损坏或恶意数据
4. **分段设计**：5 个 Object Store 各自独立，`metadata` 存本地、`webdavMetadata` 存云端，互不干扰
5. **惰性初始化**：`initialize()` 在首次操作时自动调用，不阻塞应用启动
6. **兼容双模式**：IndexedDB 在浏览器模式作为主存储，在 Electron 模式作为辅助缓存
