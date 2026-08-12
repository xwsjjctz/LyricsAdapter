# `services/desktopAdapter.ts` — 桌面端适配器

## 文件概述

提供**浏览器与 Electron 环境的统一抽象层**。通过 `DesktopAPI` 接口定义所有桌面端能力（文件读写、窗口控制、WebDAV 等），并在 Electron 可用时通过 `window.electron` 桥接实现，在浏览器中返回 `null`。应用代码通过 `getDesktopAPI()` / `isDesktop()` 使用，无需关心底层环境。

```typescript
// 位置：./services/desktopAdapter.ts
// 依赖：metadataService（parseAudioFile）、dataValidator、logger
```

---

## 接口 (Interface)

### `DesktopAPI`

```typescript
export interface DesktopAPI {
  platform: string;
  readFile: (filePath: string) => Promise<{ success: boolean; data: ArrayBuffer; error?: string }>;
  checkFileExists: (filePath: string) => Promise<boolean>;
  selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  loadLibrary: () => Promise<{ success: boolean; library: unknown; error?: string }>;
  saveLibrary: (library: unknown) => Promise<{ success: boolean; error?: string }>;
  loadLibraryIndex?: () => Promise<{ ... }>;
  saveLibraryIndex?: (library: unknown) => Promise<{ ... }>;
  saveLocalLibraryBackup?: (library: unknown) => Promise<{ ... }>;
  loadLocalLibraryBackup?: () => Promise<{ ... }>;
  validateFilePath: (filePath: string) => Promise<boolean>;
  validateAllPaths: (songs: unknown[]) => Promise<{ ... }>;
  saveAudioFile: (...) => Promise<{ ... }>;
  // ... 见下方详细说明
}
```

**说明：** 桌面端 API 的抽象接口，约 30+ 个方法，按功能分组：

#### 文件操作 (6 个)
| 方法 | 说明 |
|------|------|
| `readFile` | 读取文件为 ArrayBuffer |
| `checkFileExists` | 检查文件是否存在 |
| `selectFiles` | 打开系统文件选择对话框 |
| `saveAudioFile` | 将音频文件保存到应用目录 |
| `saveAudioFileFromBuffer` | 从 Buffer 保存音频文件 |
| `deleteAudioFile` | 删除音频文件 |

#### 曲库持久化 (6 个)
| 方法 | 说明 |
|------|------|
| `loadLibrary` | 从磁盘加载曲库 |
| `saveLibrary` | 保存曲库到磁盘 |
| `loadLibraryIndex` | 加载曲库索引（可选） |
| `saveLibraryIndex` | 保存曲库索引（可选） |
| `saveLocalLibraryBackup` | 保存曲库备份（可选） |
| `loadLocalLibraryBackup` | 加载曲库备份（可选） |

#### 路径校验 (2 个)
| 方法 | 说明 |
|------|------|
| `validateFilePath` | 验证单个文件路径 |
| `validateAllPaths` | 批量验证文件路径 |
| `getPathForFile` | 获取 File 对象对应的文件系统路径 |

#### 封面缓存 (2 个)
| 方法 | 说明 |
|------|------|
| `saveCoverThumbnail` | 保存封面缩略图到磁盘（可选） |
| `deleteCoverThumbnail` | 删除封面缩略图（可选） |

#### 元数据 (4 个)
| 方法 | 说明 |
|------|------|
| `loadMetadataCache` | 加载元数据缓存 |
| `saveMetadataCache` | 保存元数据缓存 |
| `getMetadataForSong` | 获取单曲元数据 |
| `parseAudioMetadata` | 解析音频文件元数据 |

#### 窗口控制 (5 个)
| 方法 | 说明 |
|------|------|
| `minimizeWindow` | 最小化窗口 |
| `maximizeWindow` | 最大化窗口 |
| `closeWindow` | 关闭窗口 |
| `isMaximized` | 检查是否最大化 |
| `isFullScreen` | 检查是否全屏 |
| `onFullScreenChange` | 监听全屏状态变化 |

#### WebDAV (4 个)
| 方法 | 说明 |
|------|------|
| `webdavPropfind` | WebDAV PROPFIND 请求（列出目录） |
| `webdavGetRedirect` | 获取 WebDAV 重定向 URL |
| `webdavGetRange` | WebDAV Range 请求（音频流） |
| `webdavPut` | WebDAV PUT 上传 |

#### 其他 (3 个)
| 方法 | 说明 |
|------|------|
| `getAppDataPath` | 获取应用数据目录 |
| `selectDownloadFolder` | 选择下载文件夹（可选） |
| `runStartupCleanup` | 启动时清理资源 |
| `onShortcut` | 监听快捷键（可选） |

---

## 类 (Class)

### `ElectronAdapter implements DesktopAPI`

#### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `metadataCache` | `Record<string, ValidatedMetadata>` | 内存元数据缓存 |
| `api` | `DesktopAPI` | 底层 `window.electron` API |

#### 构造函数

```typescript
constructor(private api: DesktopAPI)
```

- 初始化空的 `metadataCache`

#### 方法

| 方法 | 类型 | 说明 |
|------|------|------|
| `platform` | getter | 返回 `this.api.platform` |
| `readFile` ~ `webdavPut` | 代理方法 | 直接转发到 `this.api` 同名方法 |
| `loadLibraryIndex` | 智能回退 | 优先调用 `loadLibraryIndex`，回退到 `loadLibrary` |
| `saveLibraryIndex` | 智能回退 | 优先调用 `saveLibraryIndex`，回退到 `saveLibrary` |
| `saveCoverThumbnail` | 可选检查 | 检查方法存在再调用 |
| `minimizeWindow` | 可选检查 | 检查方法存在再调用 |
| 其他可选方法 | 可选检查 | 统一模式：`typeof fn === 'function'` 检查 |

##### `parseAudioMetadata` (重要方法)

```typescript
async parseAudioMetadata(filePath: string): Promise<{ success: boolean; metadata?: unknown; error?: string }>
```

- **说明：** 在 Electron 环境中解析音频元数据
- **流程：**
  1. 通过 `this.api.readFile(filePath)` 读取文件二进制数据
  2. 根据文件扩展名（`.mp3`/`.flac`/`.m4a`）设置 MIME 类型
  3. 构造 `File` 对象并调用 `parseAudioFile`（metadataService 的 JS 解析器）
  4. 若解析出封面，将封面 blob URL 转为 base64 数据
  5. 返回解析后的元数据（title、artist、album、duration、lyrics、coverData 等）

##### ~~refreshTrackMetadata~~ (已标记兼容性保留)

##### `webdavPropfind / getRedirect / getRange / Put`

- 直接转发到 `this.api`，通过 Electron 主进程代理 HTTP 请求以绕过 CORS

---

## 模块级变量 (Module-level Variable)

### `desktopAPI`

```typescript
let desktopAPI: DesktopAPI | null = null;
```

- **说明：** 缓存的 DesktopAPI 实例，模块级单例

---

## 函数 (Function)

### `createElectronAdapter`

```typescript
function createElectronAdapter(): ElectronAdapter | null
```

- **说明：** 检查 `window.electron` 是否存在，存在则创建 `ElectronAdapter` 实例
- **返回值：** `ElectronAdapter | null`

### `getDesktopAPI`

```typescript
export function getDesktopAPI(): DesktopAPI | null
```

- **说明：** 获取 DesktopAPI 实例（同步，单例模式）
- **逻辑：**
  1. `desktopAPI` 已缓存 → 直接返回
  2. 未缓存 → 调用 `createElectronAdapter()` 创建并缓存
  3. 无 Electron 环境 → 返回 `null`
- **返回值：** `DesktopAPI | null`

### `getDesktopAPIAsync`

```typescript
export async function getDesktopAPIAsync(): Promise<DesktopAPI | null>
```

- **说明：** 异步版本，当前实现直接调用 `getDesktopAPI()`（保留 async 签名供未来初始化使用）
- **返回值：** `Promise<DesktopAPI | null>`

### `isDesktop`

```typescript
export function isDesktop(): boolean
```

- **说明：** 快速判断当前是否在桌面端运行
- **返回值：** `getDesktopAPI() !== null`

---

## 设计要点

1. **适配器模式**：`ElectronAdapter` 封装 `window.electron`，对外暴露统一的 `DesktopAPI` 接口
2. **智能回退**：部分可选方法（如 `loadLibraryIndex`）自动回退到基础方法（`loadLibrary`）
3. **安全的可选方法调用**：所有可选 API 通过 `typeof fn === 'function'` 检查后才调用
4. **惰性单例**：`desktopAPI` 在首次调用 `getDesktopAPI()` 时创建，非模块加载时立即初始化
5. **浏览器兼容**：在纯浏览器环境（`npm run dev`）中，`isDesktop()` 返回 `false`，应用降级使用浏览器 API
6. **统一的返回格式**：所有方法返回 `{ success: boolean, ... }` 模式，便于错误处理
