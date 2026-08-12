# Tauri 移动端支持 — 实施记录

> 日期：2026-04-17
> 策略：共存方案 — 保留 Electron 桌面构建，新增 Tauri 支持移动端（Android/iOS）

---

## 1. 目标

在现有 Electron 桌面应用的基础上，增加 Tauri 2 打包层，使同一套 React 前端代码可以在 Android 和 iOS 上运行。两种打包方式共存，互不影响：

- `npm run electron:dev` / `npm run electron:build` — Electron 桌面（原有方式不变）
- `npm run tauri:dev` / `npm run tauri:build` — Tauri 桌面/移动端

---

## 2. 新增文件清单

### 2.1 `src-tauri/` — Tauri 项目目录

```
src-tauri/
├── build.rs                          # Tauri 构建脚本
├── Cargo.toml                        # Rust 依赖声明
├── Cargo.lock                        # Rust 依赖锁文件
├── tauri.conf.json                   # Tauri 核心配置（窗口、CSP、打包）
├── capabilities/
│   └── default.json                  # 权限声明（fs/dialog/http/window/event）
├── gen/
│   └── schemas/                      # Tauri 自动生成的 schema（自动生成，无需手动编辑）
├── icons/                            # 应用图标（gitignore，需用 tauri icon 生成）
└── src/
    ├── main.rs                       # 桌面入口（调用 lib::run）
    ├── lib.rs                        # 核心入口：注册插件 + 33 个 command
    └── commands/
        ├── mod.rs                    # 模块声明
        ├── file.rs                   # 文件系统操作（11 个命令）
        ├── library.rs                # 曲库持久化（6 个命令）
        ├── covers.rs                 # 封面缩略图（2 个命令）
        ├── download.rs               # 下载 + 进度推送（3 个命令）
        ├── qqmusic.rs                # QQ Music API 代理（2 个命令）
        ├── webdav.rs                 # WebDAV PROPFIND/Range/Redirect（3 个命令）
        ├── metadata_cmd.rs           # 音频元数据读写（2 个命令）
        ├── window_cmd.rs             # 窗口控制（4 个命令）
        └── cleanup_cmd.rs            # 启动清理（1 个命令）
```

### 2.2 `services/tauriAdapter.ts` — Tauri 适配器

实现与 `DesktopAPI` 完全相同的接口，内部通过 `@tauri-apps/api/core` 的 `invoke()` 调用 Rust commands。

关键设计：
- `isTauri()` 通过 `window.__TAURI_INTERNALS__` 检测运行时
- `readFile()` 将 Rust 返回的 `Vec<u8>`（序列化为 `number[]`）转换为 `ArrayBuffer`
- `saveAudioFileFromBuffer()` 将 `ArrayBuffer` 转为 `number[]` 传给 Rust
- `downloadAudioFile()` / `refreshTrackMetadata()` 同理做 buffer 类型转换

---

## 3. 修改文件清单

### 3.1 `vite.config.ts`

**改动**：根据 `TAURI_ENV_PLATFORM` 环境变量切换构建模式。

| 场景 | `TAURI_ENV_PLATFORM` | 行为 |
|------|----------------------|------|
| `npm run electron:dev` | 未设置 | 使用 `vite-plugin-electron`，构建 Electron main/preload/cleanup |
| `npm run tauri dev` | 由 Tauri CLI 自动设置 | 跳过 Electron 插件，只构建前端 dist |

具体变化：
- 从同步 `defineConfig` 改为 `async defineConfig`
- `vite-plugin-electron` 改为 `await import()` 动态加载（仅非 Tauri 模式）
- `base` 从固定 `'./'` 改为 Tauri 模式用 `'/'`
- Electron 相关的 external 配置仅在 Electron 模式下生效

### 3.2 `services/desktopAdapter.ts`

**改动**：新增 Tauri 运行时检测。

```diff
+ import { getTauriAPI } from './tauriAdapter';

  export function getDesktopAPI(): DesktopAPI | null {
    // 1. 尝试 Electron (window.electron)
    // 2. 尝试 Tauri (__TAURI_INTERNALS__)    ← 新增
    // 3. 返回 null（浏览器环境）
  }
```

优先级：Electron > Tauri > 浏览器。当 `window.electron` 不存在时，回退到 Tauri 适配器。

### 3.3 `package.json`

**新增脚本**：

```json
"tauri:dev": "tauri dev",
"tauri:build": "tauri build",
"tauri:android:init": "tauri android init",
"tauri:android:dev": "tauri android dev",
"tauri:android:build": "tauri android build",
"tauri:ios:init": "tauri ios init",
"tauri:ios:dev": "tauri ios dev",
"tauri:ios:build": "tauri ios build"
```

**新增依赖**：

| 包 | 版本 | 类型 | 用途 |
|----|------|------|------|
| `@tauri-apps/api` | ^2.10.1 | dependencies | TS 端 invoke/listen/emit |
| `@tauri-apps/plugin-fs` | ^2.5.0 | dependencies | 文件系统（预留，当前用 Rust commands） |
| `@tauri-apps/plugin-dialog` | ^2.7.0 | dependencies | 文件选择对话框（预留） |
| `@tauri-apps/plugin-http` | ^2.5.8 | dependencies | HTTP 请求（预留） |
| `@tauri-apps/cli` | ^2.10.1 | devDependencies | Tauri CLI |

### 3.4 `.gitignore`

新增 Tauri 相关忽略规则（详见第 5 节）。

---

## 4. IPC 通道映射：Electron → Tauri

34 个 `ipcMain.handle` 通道完整映射为 Rust `#[tauri::command]`：

| Electron IPC 通道 | Tauri Command | Rust 模块 | 说明 |
|---|---|---|---|
| `read-file` | `read_file` | file.rs | 读取文件为字节 |
| `check-file-exists` | `check_file_exists` | file.rs | 检查文件是否存在 |
| `select-folder` | `select_files` | file.rs | 打开文件选择对话框 |
| `get-app-data-path` | `get_app_data_path` | file.rs | 获取应用数据目录 |
| `validate-file-path` | `validate_file_path` | file.rs | 验证单个文件路径 |
| `validate-all-paths` | `validate_all_paths` | file.rs | 批量验证文件路径 |
| `save-audio-file` | `save_audio_file` | file.rs | 保存音频文件（symlink/copy） |
| `save-audio-file-from-buffer` | `save_audio_file_from_buffer` | file.rs | 从 buffer 保存音频 |
| `delete-audio-file` | `delete_audio_file` | file.rs | 删除音频文件 |
| `cleanup-orphan-audio` | `cleanup_orphan_audio` | file.rs | 清理孤立音频文件 |
| `save-file-to-path` | `save_file_to_path` | file.rs | 保存文件到指定路径 |
| `load-library` | `load_library` | library.rs | 加载完整曲库 |
| `load-library-index` | `load_library_index` | library.rs | 加载曲库索引 |
| `save-library` | `save_library` | library.rs | 保存完整曲库 |
| `save-library-index` | `save_library_index` | library.rs | 保存曲库索引 |
| `save-local-library-backup` | `save_local_library_backup` | library.rs | 保存本地曲库备份 |
| `load-local-library-backup` | `load_local_library_backup` | library.rs | 加载本地曲库备份 |
| `save-cover-thumbnail` | `save_cover_thumbnail` | covers.rs | 保存封面缩略图 |
| `delete-cover-thumbnail` | `delete_cover_thumbnail` | covers.rs | 删除封面缩略图 |
| `download-and-save` | `download_and_save` | download.rs | 下载文件到磁盘 |
| `download-audio-file` | `download_audio_file` | download.rs | 下载音频到内存 |
| `select-download-folder` | `select_download_folder` | download.rs | 选择下载目录 |
| `get-qq-music-url` | `get_qq_music_url` | qqmusic.rs | QQ Music URL 获取 |
| `get-qq-music-lyrics` | `get_qq_music_lyrics` | qqmusic.rs | QQ Music 歌词获取 |
| `webdav-propfind` | `webdav_propfind` | webdav.rs | WebDAV PROPFIND |
| `webdav-get-redirect` | `webdav_get_redirect` | webdav.rs | WebDAV 重定向获取 |
| `webdav-get-range` | `webdav_get_range` | webdav.rs | WebDAV Range 请求 |
| `write-audio-metadata` | `write_audio_metadata` | metadata_cmd.rs | 写入音频元数据 |
| `refresh-track-metadata` | `refresh_track_metadata` | metadata_cmd.rs | 刷新轨道元数据 |
| `window-minimize` | `window_minimize` | window_cmd.rs | 最小化窗口 |
| `window-maximize` | `window_maximize` | window_cmd.rs | 最大化/还原窗口 |
| `window-close` | `window_close` | window_cmd.rs | 关闭窗口 |
| `window-is-maximized` | `window_is_maximized` | window_cmd.rs | 查询最大化状态 |
| `run-startup-cleanup` | `run_startup_cleanup` | cleanup_cmd.rs | 启动时清理资源 |

### 事件通道映射

| Electron `event.sender.send` | Tauri `app.emit` | 说明 |
|---|---|---|
| `download-progress` | `download-progress` | 下载进度推送 |
| `shortcut-triggered` | 暂未实现 | 全局快捷键（移动端不适用） |

---

## 5. Rust 依赖说明

| Crate | 版本 | 用途 |
|-------|------|------|
| `tauri` | 2.x | 应用框架 |
| `tauri-plugin-fs` | 2.x | 文件系统插件 |
| `tauri-plugin-dialog` | 2.x | 文件选择对话框插件 |
| `tauri-plugin-http` | 2.x | HTTP 请求插件 |
| `serde` / `serde_json` | 1.x | JSON 序列化/反序列化 |
| `base64` | 0.22 | Base64 编解码（歌词、封面） |
| `reqwest` | 0.12 | HTTP 客户端（QQ Music API、WebDAV、下载） |
| `tokio` | 1.x | 异步运行时 |
| `lofty` | 0.22 | 音频元数据读写（替代 Electron 侧的 music-metadata + node-id3 + metaflac） |
| `uuid` | 1.x | 生成唯一 ID |
| `dirs` | 6.x | 获取系统目录（home 等） |
| `log` | 0.4 | 日志 |

### lofty 替代方案

Electron 侧使用 JS 库解析元数据：
- `music-metadata`（读取）+ `node-id3`（MP3 写入）+ `metaflac` 二进制（FLAC 写入）

Tauri 侧统一使用 Rust crate `lofty` 0.22：
- 支持 ID3v1/v2、FLAC Vorbis Comment、MP4 iTunes tag
- 读写 title/artist/album/lyrics/picture
- API：`Tag::set_title()` / `Tag::set_artist()` / `Tag::set_album()` / `Tag::insert(ItemKey::Lyrics, ...)` / `Tag::push_picture(Picture)`

---

## 6. 权限配置（capabilities）

`src-tauri/capabilities/default.json` 声明了以下权限：

| 权限组 | 具体权限 | 用途 |
|--------|----------|------|
| `core:default` | 基础权限 | 应用生命周期 |
| `core:event:*` | emit/listen | 下载进度事件 |
| `core:window:*` | close/minimize/maximize/is-maximized/start-dragging | 自定义标题栏 |
| `core:webview:default` | WebView 基础 | 前端渲染 |
| `fs:*` | read/write/exists/mkdir/remove/rename/read-dir + appdata/home 递归读写 | 文件操作 |
| `dialog:*` | open/save | 文件/目录选择 |
| `http:*` | fetch/send/cancel/read-body | HTTP 请求 |

---

## 7. 数据类型差异处理

### ArrayBuffer ↔ Vec\<u8\>

Tauri 的 `invoke()` 序列化会将 Rust 的 `Vec<u8>` 转为 JSON 数组 `number[]`。TypeScript 侧需要手动转换：

**Rust → TS（读取文件等）**：
```typescript
const result = await invoke<{ data?: number[] }>('read_file', { filePath });
const buffer = new Uint8Array(result.data).buffer; // number[] → ArrayBuffer
```

**TS → Rust（上传 buffer 等）**：
```typescript
const data = Array.from(new Uint8Array(fileData)); // ArrayBuffer → number[]
await invoke('save_audio_file_from_buffer', { fileName, fileData: data });
```

---

## 8. .gitignore 新增规则

```gitignore
# Tauri
/src-tauri/icons/           # 图标文件（用 tauri icon 命令生成）
/src-tauri/target/           # Rust 编译产物
/src-tauri/gen/              # Tauri 自动生成的平台项目（android/ios）
/src-tauri/WixTools/         # Windows MSI 打包工具
```

---

## 9. 快速开始

### 桌面开发（Tauri 模式）

```bash
npm run tauri:dev
```

### Android

```bash
# 首次需要初始化
npm run tauri:android:init
# 开发
npm run tauri:android:dev
# 构建
npm run tauri:android:build
```

### iOS

```bash
# 首次需要初始化（需要 Xcode）
npm run tauri:ios:init
# 开发
npm run tauri:ios:dev
# 构建
npm run tauri:ios:build
```

### Electron（不受影响）

```bash
npm run electron:dev
npm run electron:build
```

---

## 10. 已知限制与后续工作

1. **移动端 UI 适配**：当前 UI 是桌面布局（自定义标题栏、键盘快捷键），移动端需要响应式改造
2. **`cover://` 协议**：Electron 注册的自定义协议在 Tauri 中需要改为 `asset:` 协议或 custom protocol
3. **快捷键事件**：`shortcut-triggered` 事件尚未在 Tauri 中实现（移动端不适用）
4. **图标**：当前使用占位图标，需要用 `npx tauri icon <source-image>` 生成正式图标
5. **直接调用 `window.electron`**：`BrowseView.tsx` 和 `qqMusicApi.ts` 中有绕过 `desktopAdapter` 直接调用 `window.electron` 的代码，Tauri 模式下需统一走 `desktopAdapter` 或 `tauriAdapter`
6. **`getPathForFile`**：Tauri 没有 Electron 的 `webUtils.getPathForFile` 等价 API，拖拽导入需要替代方案
7. **`symlink`**：`save_audio_file` 在 Android/iOS 上可能不支持符号链接，会自动回退到 copy
