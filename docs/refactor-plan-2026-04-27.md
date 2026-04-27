# Refactor Plan — LyricsAdapter

Date: 2026-04-27
Status: Draft

## 目标

简化应用架构，统一数据源模型，消除冗余视图，提升交互一致性。

---

## 一、当前问题

### 1.1 local/cloud 切换交互隐蔽

local 和 cloud 是两个独立的播放上下文（各自维护 tracks、进度、音量、播放模式），但在 UI 上被呈现为 LibraryView 标题栏里和 album/artist 过滤器同级的两个小图标按钮。这种「最高层级的状态切换」和「列表视图过滤」在视觉上完全同级，违反信息层级原则。

### 1.2 BrowseView 数据链路冗余

BrowseView 同时承载 QQ Music 搜索和 WebDAV 浏览，但两者的数据完全独立、无法互通。QQ Music 下载的文件只存本地，WebDAV 浏览需要每次解析音频头部元数据，效率低。

### 1.3 MetadataView 交互割裂

元数据编辑需要先切换到独立视图，再从库中选曲，流程割裂。且编辑操作不在曲目上下文中，不符合直觉。

### 1.4 LibraryView 职责过重

一个组件 (1487行) 承担：虚拟化列表、搜索过滤、编辑模式、文件拖放、曲目排序、分类视图、滚动恢复、高亮动画、删除确认、WebDAV 自动加载。local/cloud 切换和 album/artist 分类视图的渲染代码大量重复。

---

## 二、目标架构

### 2.1 Sidebar 简化为二级结构

```
┌─────────────┐
│ 📁 本地 (23) │  ← 本地导入的音频，内嵌元数据
│ ☁️ 云端 (15) │  ← WebDAV 中的音频，音频 + meta.json sidecar
│ ─────────── │
│ ⚙️ 设置      │
│ 🎨 主题      │
└─────────────┘
```

local 和 cloud 提升为 Sidebar 一级导航下的二级项，"音乐库"作为分组标签。

### 2.2 搜索改为 TitleBar 全局搜索

搜索框放置在 TitleBar 中间区域，不影响窗口拖动和系统按钮。

交互流程：

```
点击搜索框 / Ctrl+F
    │
    ▼
┌─────────────────────────────────────┐
│  🔍 晴天                            │  ← 不在 TitleBar 下方弹出的下拉面板
├─────────────────────────────────────┤
│  📁 本地                            │
│  ├─ 晴天 · 周杰伦    3:42  [本地]   │  ← 即时显示（本地搜索）
│  └─ 晴天 · 刘瑞琦    4:15  [本地]   │
│                                     │
│  ☁️ WebDAV                          │
│  ├─ 晴天 · 林俊杰    4:24  [云端]   │  ← 即时显示（本地缓存）
│  └─ 花海 · 周杰伦    4:00  [云端]   │
│                                     │
│  🌐 QQ 音乐                         │
│  ├─ 晴天 · 周杰伦    4:29  [下载] [+] ← debounce 300ms 后懒加载
│  └─ 晴天 · 张学友    4:14  [下载] [+] ← API 返回后追加渲染
└─────────────────────────────────────┘
```

**三级命中策略**：
1. **local** — 本地即时搜索，毫秒级
2. **cloud** — 基于本地缓存的 meta.json 搜索，毫秒级
3. **QQ Music** — 外部 API 搜索，debounce 300ms 后发起

**搜索结果操作**：
- 点击 local/cloud 结果 → 关闭面板，切换到对应 slot 并定位播放
- `[下载]` → 下载音频（嵌入元数据）→ 存入 local
- `[+]` → 下载音频 → 分离生成 meta.json → 一并上传到 WebDAV
- Esc / 点击面板外 → 关闭搜索面板

### 2.3 WebDAV Sidecar 元数据

WebDAV 存储结构：

```
WebDAV:/music/
  ├── 周杰伦-晴天.flac
  ├── 周杰伦-晴天.meta.json    ← sidecar 元数据
  ├── 林俊杰-江南.mp3
  ├── 林俊杰-江南.meta.json
  └── ...
```

**浏览时**：只读取 `.meta.json` 文件构建列表（远比解析音频头部快）。
**播放时**：通过 Range 请求流式加载音频文件（与现在一致）。
**meta.json 生成时机**：
- QQ Music `[+]` 上传时一并生成
- 本地编辑模式「上传到 WebDAV」时提取内嵌元数据生成
- WebDAV 中已有纯音频（无 meta.json）时首次播放懒生成

### 2.4 元数据编辑改为上下文操作

- 列表中右键曲目 → 弹出元数据编辑面板（或行内展开）
- 「上传到 WebDAV」→ 本地库编辑模式下选中 → 上传音频 + 自动提取 meta.json
- 「下载到本地」→ 云端库编辑模式下选中 → 下载音频文件

### 2.5 交互矩阵总览

| 操作 | 入口 | 效果 |
|------|------|------|
| 导入本地音频 | 侧边栏导入按钮 / 拖拽 | 解析内嵌元数据 → 加入 local |
| 本地 → WebDAV | 本地库编辑模式 → 上传 | 上传音频 + 提取 meta.json |
| WebDAV → 本地 | 云端库 → 下载 | 下载音频 → 加入 local |
| 全局搜索 | TitleBar 搜索框 / Ctrl+F | 三级命中 → 结果面板 |
| 搜索命中 local | 点击结果 | 切到本地库 → 定位播放 |
| 搜索命中 cloud | 点击结果 | 切到云端库 → 定位播放 |
| QQ Music `[下载]` | 搜索结果 | 下载 + 嵌入元数据 → 存入 local |
| QQ Music `[+]` | 搜索结果 | 下载 + 上传音频+meta.json → WebDAV |
| 编辑元数据 | 列表右键 | 行内 / 弹出面板编辑 |

---

## 三、可移除的代码

| 模块 | 理由 |
|------|------|
| `BrowseView.tsx` (~33KB) | 搜索合并到 TitleBar 全局搜索 |
| `MetadataView.tsx` (~26KB) | 元数据编辑改为右键/行内操作 |
| `ViewMode.BROWSE` | 不再需要独立的浏览视图 |
| `ViewMode.METADATA` | 不再需要独立的元数据视图 |
| `useWebDAV.ts` 部分逻辑 | WebDAV 浏览简化，侧边栏点击 cloud 时加载 |

---

## 四、实施步骤

### Phase 1: Sidebar 重构 (local/cloud 提升)
- 将 local/cloud 切换从 LibraryView 移到 Sidebar
- LibraryView 不再接收 `dataSource` / `onDataSourceChange`
- 保持现有功能不变，仅移动 UI 控件位置

### Phase 2: meta.json Sidecar 方案
- 设计 `meta.json` schema
- WebDAV 浏览改为优先读 meta.json，fallback 解析音频头部
- QQ Music `[+]` 按钮：下载后上传音频 + meta.json
- 本地上传 WebDAV：提取内嵌元数据生成 meta.json

### Phase 3: TitleBar 全局搜索
- 在 TitleBar 中间添加搜索框
- 实现搜索下拉面板（local / cloud / QQ Music 三级结果）
- 实现 [下载] 和 [+] 按钮交互
- 删除 BrowseView

### Phase 4: 元数据编辑上下文化
- 列表行内右键菜单或展开编辑面板
- 上传 WebDAV / 下载到本地 作为编辑模式的操作
- 删除 MetadataView

### Phase 5: 清理与优化
- 删除移除的代码和类型
- LibraryView 拆分为更小的组件
- 统一分类视图和默认视图的渲染逻辑

---

## 五、meta.json Schema 草案

```typescript
interface MetaJson {
  // Track identity
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;           // seconds
  fileSize: number;           // bytes
  fileName: string;

  // Lyrics (pre-parsed)
  lyrics?: string;
  syncedLyrics?: SyncedLyricLine[];

  // Cover
  coverHash?: string;         // MD5 of cover image data
  coverMime?: string;         // e.g. "image/jpeg"

  // Metadata
  addedAt: string;            // ISO 8601
  lastModified: number;       // timestamp
}
```

---

## 六、不变的部分

- 音频播放核心逻辑 (usePlayback)
- 双槽系统 (useLibrarySlots) — 保留但入口从 LibraryView 移到 Sidebar
- 封面缓存系统 (cover:// 协议)
- 虚拟化列表 (保留在 LibraryView)
- 本地文件导入流程
- 主题系统和 i18n
- QQ Music API 代理 (electron/ipc/handlers.ts)
- WebDAV 流式播放
