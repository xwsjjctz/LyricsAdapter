<div align="center">

<img src="app-icon.png" width="120" height="120" alt="LyricsAdapter logo">

# LyricsAdapter

**一款功能丰富的 Electron 桌面音乐播放器，专注于歌词同步显示和沉浸式播放体验**

[![React](https://img.shields.io/badge/React-18.2.0-61DAFB?logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.2-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.1.0-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Electron](https://img.shields.io/badge/Electron-42.5.0-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.3.1-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-GPLv3-green.svg)](LICENSE)

[功能特性](#-功能特性) • [界面预览](#-界面预览) • [快速开始](#-快速开始) • [使用指南](#-使用指南) • [项目结构](#-项目结构) • [架构](#-架构)

</div>

---

## ✨ 功能特性

### 🎵 核心播放功能

- **多格式音频支持** - 完整支持 FLAC、MP3 等常见音频格式
- **智能元数据解析** - 自动提取音频文件内嵌的标题、艺术家、专辑、封面、歌词等信息（Rust lofty 引擎）
- **同步歌词显示** - LRC 歌词毫秒级精确同步；在线音源可获取 QRC/YRC 逐字歌词，并持久化到音频文件自定义标签
- **流式本地播放** - 本地文件通过 `audio://` 自定义协议按 Range 请求流式读取，不整载入内存
- **完整播放控制** - 播放/暂停、上一曲/下一曲、进度调节、音量控制
- **系统媒体集成** - 向 macOS 控制中心与 Windows 系统媒体控制发布歌曲信息、封面和播放操作
- **系统歌词** - macOS 菜单栏实时歌词；Windows 由 Electron HTML/CSS 渲染 Fluent 风格界面，并通过独立实现的 C++ Node-API/Win32 桥接将歌词窗口嵌入任务栏
- **多种播放模式** - 顺序播放、单曲循环、随机播放

### 🎨 用户界面

- **精美 UI 设计** - 玻璃拟态效果、GSAP 驱动的页面与过渡动画
- **沉浸式模式** - 全屏显示，动态背景跟随封面色调，歌词实时同步滚动
- **虚拟化列表** - 大型音乐库流畅滚动，支持拖拽排序
- **拼音搜索** - 中文曲目支持拼音首字母与全拼搜索
- **5 种预设主题** - 默认深色、默认浅色、经典蓝、暖米、粗粝黄
- **6 种语言支持** - 中文、英文、日语、韩语、德语、法语（i18next）

### 🌐 在线与云端功能

- **多在线音源** - QQ 音乐与网易云音乐，可在设置中切换
- **扫码登录** - QQ 音乐与网易云音乐支持二维码扫码登录，解锁高音质与歌单
- **在线搜索与下载** - 搜索、试听、下载（128kbps / 320kbps / FLAC），自动写入标签与歌词
- **歌单支持** - 浏览与播放第三方歌单，独立播放上下文
- **WebDAV 云曲库** - 浏览、流式播放 WebDAV 服务器上的音乐，支持从本地或在线音源上传
- **自动更新** - 内置 electron-updater，发布新版本后应用内自动检查更新

### 💾 数据管理

- **SQLite 持久化** - 曲库与设置存储在 `~/.la/state.sqlite3`，独立于 Chromium 可清除的缓存目录
- **四槽播放上下文** - 本地 / 云端 / 在线 / 歌单各自独立保存进度、音量与浏览状态
- **封面缓存** - 内嵌封面提取到 `userData/covers/`，经 `cover://` 协议按需降采样

---

## 🎬 界面预览

### 主界面
简洁优雅的曲库管理界面，本地/云端独立播放上下文，支持批量导入、拼音搜索、编辑和拖拽排序

![库界面](resource/LibraryView_1.png)

分类视图按专辑/艺术家浏览曲库，一键切换浏览维度

![分类视图](resource/LibraryView_2.png)

### 沉浸式歌词模式
全屏沉浸体验，动态背景跟随封面色调，歌词实时同步滚动

![沉浸式模式1](resource/FocusMode_1.png)
![沉浸式模式2](resource/FocusMode_2.png)


---

## 🚀 快速开始

### 前置要求

- **Node.js** 24.19.x
- **npm** 9.0 或更高版本（或 yarn/pnpm）
- **操作系统**：Windows 10+、macOS 10.15+、Linux (x64/arm64)
- **Windows 原生桥接**：源码安装需要 Visual Studio 2022 的“使用 C++ 的桌面开发”工作负载与 Python 3；`npm install` 会自动针对当前 Electron/架构编译，也可执行 `npm run native:rebuild:taskbar -- --force`
- **macOS 原生桥接**：源码安装需要 Xcode Command Line Tools 与 Python 3；`npm install` 会自动针对当前 Electron/架构编译，也可执行 `npm run native:rebuild:macos-statusbar -- --force`

### 安装与运行

1. **克隆仓库**
   ```bash
   git clone https://github.com/xwsjjctz/LyricsAdapter.git
   cd LyricsAdapter
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动开发服务器**
   ```bash
   npm run electron:dev
   ```

4. **开始使用**
   - 应用窗口将自动打开
   - 点击侧边栏的"导入文件"按钮
   - 选择音频文件（支持批量选择和多格式）
   - 开始享受音乐！

### 其他命令

```bash
# 仅启动浏览器版渲染层
npm run dev

# 启动带 CDP / 主进程调试端口的 Electron
npm run electron:debug

# 运行类型检查、单元测试和生产构建
npm run check

# 运行真实 Electron 冒烟测试
npm run test:e2e

# 构建 Windows 版本 (x64)
npm run electron:build:win

# 构建 Windows 版本 (ARM64)
npm run electron:build:win:arm64

# 构建 macOS 版本
npm run electron:build:mac

# 构建 Linux 版本
npm run electron:build:linux

# 构建当前平台版本
npm run electron:build
```

构建产物将输出到 `release/` 目录。

---

## 📘 使用指南

### 音乐库管理

#### 导入音乐

- **方式一**：点击侧边栏的"导入文件"按钮，选择音频文件
- **方式二**：直接拖拽音频文件到应用窗口
- **支持格式**：`.flac`, `.mp3`

#### 管理曲目

- **搜索**：使用侧边栏的搜索框快速查找曲目（支持拼音）
- **删除**：点击曲目右侧的删除按钮，或进入编辑模式批量删除
- **排序**：拖拽曲目进行自定义排序
- **定位**：点击"定位到当前播放"快速定位到正在播放的曲目

#### 编辑元数据

1. 切换到"元数据"视图
2. 从音乐库选择曲目
3. 编辑标题、艺术家、专辑、歌词等信息
4. 保存更改（写回音频文件标签）

### 在线音乐

#### 配置音源

1. 进入"设置"视图，在"音源"部分选择 QQ 音乐 / 网易云音乐
2. 需要高音质或歌单功能时，在设置中扫码登录对应平台

#### 搜索与下载

1. 切换到"浏览"视图
2. 在搜索框输入歌曲名、艺术家或专辑名
3. 点击搜索结果即可试听（在线流式播放）
4. 点击下载或上传按钮，选择音质：
   - **128kbps** - 标准音质，文件较小
   - **320kbps** - 高品质，推荐使用
   - **FLAC** - 无损音质，文件较大

下载的文件会自动写入完整的元数据、封面和歌词（含逐字歌词），并添加到本地音乐库；也可以选择直接上传到 WebDAV 云端。

#### 歌单

在"浏览"视图的歌单标签页查看与播放第三方平台歌单，歌单拥有独立的播放上下文，不影响本地曲库状态。

#### 设置下载路径

在设置对话框中配置下载文件夹路径：
- 支持使用 `~` 代表用户主目录
- 例如：`~/Music` → `/Users/你的用户名/Music`

### WebDAV 云端播放

#### 配置 WebDAV 服务器

1. 进入"设置"视图
2. 找到"WebDAV 设置"部分
3. 填写以下信息：
   - **服务器地址**：WebDAV 服务器 URL（如 `https://example.com/dav`）
   - **用户名**：认证用户名
   - **密码**：认证密码
   - **根目录**：WebDAV 根目录路径（可选）

#### 浏览云端音乐

1. 切换到"云端"库
2. 浏览服务器目录结构
3. 点击音频文件即可播放（无需下载）

#### 云端播放特性

- **流式播放**：音频文件按需通过代理加载 Range 分片，不占用本地存储
- **元数据缓存**：远端曲目元数据与文件列表快照缓存在 IndexedDB，二次进入秒开
- **独立状态**：云端播放状态与本地库独立保存

### 沉浸式播放

进入沉浸式模式：
- **方式一**：点击底部控制栏的"专注模式"按钮
- **方式二**：使用快捷键 `Ctrl/Cmd + Enter`

沉浸式模式特性：
- 全屏歌词显示
- 动态背景颜色跟随封面提取
- 歌词自动滚动到当前行
- 点击歌词行可跳转到对应时间点
- 支持鼠标和键盘控制播放

### 主题切换

应用内置 5 套主题：默认深色、默认浅色、经典蓝、暖米、粗粝黄

切换方式：
1. 点击侧边栏的"主题"按钮
2. 预览并选择喜欢的主题
3. 点击"应用"按钮

### 快捷键

应用提供完整的快捷键支持，且可自定义。

#### 播放控制

| 快捷键 | 功能 | 说明 |
|--------|------|------|
| `Space` | 播放/暂停 | 切换播放状态 |
| `Ctrl/Cmd + ←` | 上一首 | 切换到上一曲目 |
| `Ctrl/Cmd + →` | 下一首 | 切换到下一曲目 |
| `←` | 快退 5 秒 | 向后快退 5 秒 |
| `→` | 快进 5 秒 | 向前快进 5 秒 |
| `Alt + ←` | 快退 30 秒 | 向后快退 30 秒 |
| `Alt + →` | 快进 30 秒 | 向前快进 30 秒 |
| `↑` | 音量增加 | 增加 1% 音量 |
| `↓` | 音量减少 | 减少 1% 音量 |
| `Alt + ↑` | 音量增加 10% | 增加 10% 音量 |
| `Alt + ↓` | 音量减少 10% | 减少 10% 音量 |
| `M` | 静音/取消静音 | 切换静音状态 |
| `Tab` | 切换播放模式 | 循环切换播放模式 |

#### 导航

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/Cmd + Enter` | 进入/退出沉浸模式 |
| `Ctrl/Cmd + F` | 聚焦搜索框 |
| `Ctrl/Cmd + B` | 跳转到浏览 |
| `Ctrl/Cmd + Shift + M` | 跳转到元数据视图 |
| `Ctrl/Cmd + ,` | 打开设置 |
| `Ctrl/Cmd + T` | 打开主题 |

#### 自定义快捷键

1. 进入"设置"视图
2. 点击"快捷键"部分
3. 点击要修改的快捷键按钮
4. 按下新的组合键
5. 按 `Esc` 取消，按 `Backspace` 清除

---

## 🛠️ 技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| **React** | 18.2.0 | 用户界面框架，使用 Hooks 和函数组件 |
| **TypeScript** | ~5.8.2 | 类型安全的 JavaScript 超集 |
| **Vite** | ^8.1.0 | 下一代前端构建工具，快速热更新 |
| **Electron** | ^42.5.0 | 跨平台桌面应用框架 |
| **C++ Node-API / Win32** | Node-API 8 | Windows 任务栏子窗口桥接；界面仍由 Electron HTML/CSS 渲染 |
| **Tailwind CSS** | ^4.3.1 | 实用优先的 CSS 框架 |
| **GSAP** | ^3.15.0 | 页面切换与过渡动画 |
| **music-tag-native** | ^1.0.0 | 音频元数据解析/写入库（Rust lofty 引擎） |
| **@applemusic-like-lyrics/lyric** | ^1.0.2 | QRC/YRC 逐字歌词解析 |
| **i18next / react-i18next** | ^26 / ^17 | 国际化框架（6 种语言） |
| **zod** | ^4.4.3 | typed IPC payload 校验 |
| **electron-updater** | ^6.3.9 | 应用自动更新 |
| **node:sqlite** | 内置 | 用户状态持久化（`~/.la/state.sqlite3`） |

### 构建工具

- **Vite Plugin Electron** - Electron 集成插件
- **Electron Builder** - 跨平台打包工具
- **node-gyp / @electron/rebuild** - 针对当前 Electron 与系统架构从源码编译 Node-API 模块
- **cross-env** - 跨平台环境变量设置

---

## 📁 项目结构

```
LyricsAdapter/
├── electron/                # Electron 主进程
│   ├── main.ts              # 入口：协议注册、IPC 注册、窗口创建、更新器
│   ├── preload.ts           # contextBridge，暴露受控的 window.electron
│   ├── windowManager.ts     # frameless 窗口与窗口状态
│   ├── native/              # Node-API 桥接加载、校验与平台降级
│   ├── protocols/           # 自定义协议：audio:// cover:// stream:// app://
│   ├── ipc/                 # typed + legacy IPC handlers（文件、曲库、WebDAV、在线音源、登录…）
│   └── services/            # SQLite 用户状态仓库、音频元数据读写、设置存储
├── native/
│   └── windows-taskbar-native/ # 独立实现的 C++ Node-API/Win32 任务栏子窗口桥接
├── src/                     # Renderer（React）
│   ├── App.tsx              # 根组合点 + ErrorBoundary（wiring/composition only）
│   ├── components/          # UI 组件（new-ui/、focus-mode/、settings/、legacy/）
│   ├── controllers/         # 播放/曲库控制器（状态变更的唯一入口）
│   ├── viewmodels/          # 面向视图的数据模型
│   ├── stores/              # hook 聚合层（library / player / import / ui）
│   ├── hooks/               # 业务 hooks（播放、导入、WebDAV、快捷键…）
│   ├── services/            # desktopAdapter、libraryStorage、metadataService、
│   │                        # qqMusicApi / neteaseMusicApi、
│   │                        # onlineMusicProvider、webdavClient、主题、i18n…
│   ├── domain/              # 纯领域规则
│   ├── repositories/        # 数据访问封装
│   ├── shared/              # LRC/QRC/YRC 解析、持久化策略、schema
│   ├── taskbar-lyrics/      # Windows 任务栏歌词的独立 HTML/CSS 渲染界面
│   └── i18n/                # 6 种语言的 locale 文件
├── test/                    # Vitest 单元测试 + Playwright Electron E2E
├── docs/                    # 架构与开发文档（overview / playback-flow / …）
└── resource/                # 文档截图等资源
```

> UI 组件不直接改状态，用户意图通过回调交给 controllers；播放一律走 player controller，曲库变更一律走 library controller。详见 [AGENTS.md](AGENTS.md) 的所有权边界。

---

## 🏗️ 架构

### 数据流

#### 文件导入流程

```
用户选择文件（对话框 / 拖拽）
    ↓
路径进入主进程 allowlist（typed IPC）
    ↓
元数据解析（music-tag-native / metadataService）
    ↓
封面提取与缓存（userData/covers → cover://）
    ↓
创建 Track 对象
    ↓
保存曲库（librarySerializer → SQLite）
    ↓
更新 UI
```

#### 播放流程

```
用户点击播放（player controller）
    ↓
按 Track.source 选择播放 URL：
  - local   → audio://<路径>（主进程流式 Range 响应）
  - webdav  → 主进程代理的 HTTP Range 请求
  - qq/netease → stream://（补 cookie、解析 CDN、转发 Range）
    ↓
HTML <audio> 播放，进度/音量/模式同步回对应 slot
    ↓
预加载相邻曲目
```

#### 在线音乐流程

```
用户搜索/打开歌单（BrowseView）
    ↓
onlineMusicProvider（qq / netease 归一为 OnlineSong）
    ↓
播放 → stream:// 流式试听
下载 → downloadAndSave + writeAudioMetadata（写入标签/封面/QRC 歌词）
上传 → 读取字节 PUT 到 WebDAV
    ↓
合并进 local / cloud slot
```

#### Windows 任务栏歌词流程

```
播放器快照 → typed IPC → Electron 专用歌词 BrowserWindow（HTML/CSS）
    ↓
BrowserWindow HWND → C++ Node-API/Win32 桥接
    ↓
SetParent 嵌入任务栏 + window region / DPI 感知定位
```

歌词内容、封面和 Fluent 风格均由隔离的 Electron 渲染页负责；Windows-only C++ 桥接只处理 HWND、任务栏父子关系、窗口区域与定位。该桥接在本仓库中独立实现，不需要 C#/.NET 辅助进程。详见 [第三方声明](docs/THIRD_PARTY_NOTICES.md) 中的设计与许可说明。

### 播放槽系统（Library Slots）

应用维护四个独立槽位，每个槽保存 `tracks`、当前索引、进度、音量、播放模式、滚动位置与筛选状态：

| Slot | 用途 | 侧边栏入口 |
|------|------|-----------|
| `local` | 本地导入曲库 | 有 |
| `cloud` | WebDAV 云曲库 | 有 |
| `online` | 在线试听最近播放（LRU） | 有 |
| `playlist` | 歌单播放上下文 | 无（Playlists 视图背后） |

当前播放上下文是 `activeSlotId`，曲库面板浏览的是 `viewSlot`，两者可以不同——例如播放歌单的同时浏览本地曲库。切换槽位会恢复该槽状态，且 `isPlaying` 始终重置为 `false`。

### 持久化存储

| 数据 | 位置 |
|------|------|
| 曲库成员、设置、用户状态 | `~/.la/state.sqlite3`（首启自动从旧版 JSON 迁移） |
| 封面缓存 | `userData/covers/`（`cover://` 协议按需降采样） |
| 元数据缓存、WebDAV 快照 | IndexedDB（renderer 侧，LRU） |
| 浏览器模式曲库 | IndexedDB + localStorage |

> 用户数据放在 `~/.la` 而不是 Chromium 的 userData 目录，"清除浏览器数据"不会丢曲库。

---

## 📚 开发文档

### 开发环境设置

1. **克隆仓库并安装依赖**
   ```bash
   git clone https://github.com/xwsjjctz/LyricsAdapter.git
   cd LyricsAdapter
   npm install
   ```

2. **启动开发服务器**
   ```bash
   npm run electron:dev
   ```

3. **开发工具**
   - Chromium DevTools / CDP - 渲染进程、DOM、网络与控制台调试
   - Node Inspector - Electron 主进程断点调试
   - Playwright MCP - AI Agent 通过 CDP 检查和操作运行中的 Electron

   完整配置和使用方法见 [Electron 调试与 Agent 工作流](DEBUGGING.md)，
   架构细节见 [docs/architecture/overview.md](docs/architecture/overview.md)。

### 代码规范

- **组件**：使用函数组件和 Hooks
- **类型**：所有 Props 和 State 都应定义 TypeScript 类型
- **命名**：组件使用 PascalCase，其他使用 camelCase
- **样式**：使用 Tailwind CSS 类名
- **日志**：使用 `logger` 服务，不要直接使用 `console.*`
- **边界**：UI 不改状态，播放走 player controller，曲库变更走 library controller

### 添加新功能

1. **创建新组件**
   - 在 `src/components/` 相应子目录创建 `.tsx` 文件
   - 定义 Props 接口，通过回调向上传递用户意图
   - 使用 Tailwind CSS 编写样式

2. **添加新服务**
   - 在 `src/services/` 目录创建 `.ts` 文件
   - 桌面能力一律通过 `services/desktopAdapter.ts` 访问
   - 新增在线音源实现 `OnlineMusicProvider` 接口即可接入

3. **添加新类型**
   - 在 `src/types.ts` 或 `src/types/` 目录添加类型定义
   - 使用 TypeScript 严格模式

4. **添加新主题**
   - 在 `src/services/themes/predefinedThemes.ts` 添加主题配置
   - 在 `src/i18n/locales/` 添加主题名称和描述翻译

### 调试技巧

需要跨渲染进程、预加载脚本和主进程调试时，先运行 `npm run electron:debug`，再按 [DEBUGGING.md](DEBUGGING.md) 连接 CDP、MCP 或 VS Code。

1. **查看日志**
   - 开发环境：控制台查看 `logger.debug()` 和 `logger.info()` 输出
   - 生产环境：仅显示 `logger.warn()` 和 `logger.error()`

2. **检查 Electron IPC**
   ```typescript
   logger.debug('[App] IPC call:', result);
   ```

3. **检查状态更新**
   ```typescript
   useEffect(() => {
     logger.debug('[Component] State changed:', state);
   }, [state]);
   ```

---

## ❓ 常见问题

### 1. 如何批量导入音乐？

**方法**：
- 在文件选择对话框中按住 `Ctrl` (Windows/Linux) 或 `Cmd` (macOS) 多选
- 直接拖拽文件到应用窗口

### 2. 应用数据存储在哪里？

**存储位置**：
- **曲库与设置**：`~/.la/state.sqlite3`（所有平台一致，独立于应用缓存）
- **封面缓存**：
  - **macOS**: `~/Library/Application Support/lyrics-adapter/covers/`
  - **Windows**: `%APPDATA%/lyrics-adapter/covers/`
  - **Linux**: `~/.config/lyrics-adapter/covers/`

### 3. 如何迁移音乐库？

**步骤**：
1. 备份 `~/.la/state.sqlite3` 与音频文件
2. 在新设备上安装应用
3. 恢复数据库文件到相同位置，音频文件保持原路径（或重新导入）
4. 重启应用

### 4. 支持哪些音频格式？

**导入格式**：
- **FLAC** - 无损压缩格式（推荐）
- **MP3** - 通用有损压缩格式

### 5. 在线音源无法播放或音质受限？

部分音源需要登录才能获取完整音质与歌单：进入"设置"视图，选择音源并扫码登录。登录态以加密 Cookie 形式保存在本地。

### 6. 如何自定义快捷键？

**步骤**：
1. 进入"设置"视图
2. 找到"快捷键"部分
3. 点击要修改的快捷键
4. 按下新的组合键
5. 按 `Esc` 取消，按 `Backspace` 清除

---


## 📄 许可证

本项目采用 GPL 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情
项目内APP图标使用 CC BY 4.0 授权 - 查看 [app-icon-LICENSE](app-icon-LICENSE) 文件了解详情
第三方源码与实现致谢 - 查看 [第三方声明](docs/THIRD_PARTY_NOTICES.md)

---

## 🙏 致谢

### 核心依赖

- [React](https://reactjs.org/) - 用户界面框架
- [TypeScript](https://www.typescriptlang.org/) - 类型安全
- [Vite](https://vitejs.dev/) - 构建工具
- [Electron](https://www.electronjs.org/) - 桌面应用框架
- [Tailwind CSS](https://tailwindcss.com/) - CSS 框架
- [GSAP](https://gsap.com/) - 动画引擎
- [music-tag-native](https://github.com/subframe7536/music-tag-native) - 音频元数据解析/写入库
- [@applemusic-like-lyrics/lyric](https://github.com/Steve-xmh/applemusic-like-lyrics) - 逐字歌词解析

### 图标与设计

- [Material Symbols](https://fonts.google.com/symbols) - 图标库
