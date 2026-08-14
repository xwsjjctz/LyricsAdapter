# Code Review — LyricsAdapter

> 审查日期 / Review Date: 2026-04-27
> 审查范围 / Scope: 全部源代码文件 (~53 TypeScript 文件) / All source files (~53 TypeScript files)
> 审查性质 / Nature: 只读，未修改任何代码 / Read-only, no code changes made

---

## 总体架构评估 / Overall Architecture Assessment

**优点 / The Good:** 应用功能完整，UX 打磨精细（沉浸模式的 Canvas 背景渐变过渡、虚拟滚动、WebDAV 差异同步、带暂存/未保存提示的元数据编辑器）。TypeScript 配置极为严格（`noUncheckedIndexedAccess: true`、`exactOptionalPropertyTypes: true`），日志系统结构良好，不可变更新模式使用一致。

**问题 / The Bad:** 这是一个典型的有机增长项目——核心架构问题如下。

### 1. 无状态管理方案 — React Hooks 无法承载当前复杂度 (严重)
### No State Management — React Hooks Alone Can't Handle This Complexity (CRITICAL)

`App.tsx` 是一个 605 行的巨型组件。它通过 prop drilling 和庞大的 hook 接口管理两个独立播放槽位（本地/云端）、文件导入、库持久化、主题初始化、Blob URL 生命周期、快捷键、元数据编辑器未保存提示、滚动位置等所有状态。

`App.tsx` is a 605-line god component managing two independent playback slots, file import, library persistence, theme, blob URLs, shortcuts, unsaved-changes dialogs, and scroll positions — all via prop drilling and massive hook interfaces.

| Hook | 参数/返回值数量 / Params or Returns |
|------|-------------------------------------|
| `usePlayback` | 返回 22 个值 / Returns 22 values |
| `useLibrarySlots` | 返回 17 个值 / Returns 17 values |
| `useImport` | 接收 12 个参数 / Receives 12 params |
| `useLibraryLoad` | 接收 12 个参数 / Receives 12 params |
| `useShortcuts` | 接收 16 个参数 / Receives 16 params |

**建议 / Recommendation:** 引入 Zustand 或 Jotai，或至少使用 `useReducer` + Context。每个 hook 至少应使用单个 options object 参数。

### 2. 巨型组件远超文件大小限制 (严重)
### Monolithic Components Far Exceeding Size Limits (CRITICAL)

| 文件 / File | 行数 / Lines | 超出比例 / Over Limit |
|-------------|-------------|----------------------|
| `components/LibraryView.tsx` | 1,487 | 超出 86% (限制 800 行) |
| `components/FocusMode.tsx` | 1,114 | 超出 39% |
| `App.tsx` | 605 | 未超标但职责过多 |

`LibraryView.tsx` 单独包含：虚拟滚动、拖放导入、拖放排序、搜索、专辑/艺术家筛选、本地/云端数据源切换、WebDAV 同步、编辑模式批量删除、内联确认弹窗、定位当前曲目按钮、进度条等。应拆分为至少 8-10 个专注的组件。

### 3. `Track` 类型中的 `audioUrl: string` 不可选 (严重)
### `audioUrl: string` in Track Type is NOT Optional (CRITICAL)

`types.ts:11` — `audioUrl: string` 应改为 `audioUrl?: string`。CLAUDE.md 明确说明「tracks stored without audioUrl initially (lazy loading)」。当前每个创建 Track 的地方都必须提供空字符串占位（如 `audioUrl: ''`），这在类型层面是一个谎言。应改为可选。

---

## 逐文件审查 / File-by-File Review

### `types.ts` (79 行 / lines)

| 严重度 / Severity | 行 / Line | 问题 / Issue |
|:---:|:---:|---|
| **严重** | 11 | `audioUrl: string` 应为可选，tracks 是懒加载的 / should be optional, tracks are lazy-loaded |
| **中等** | 12 | `file?: File` 已废弃（仅浏览器模式），需 `@deprecated` 标签 / deprecated browser-only, needs `@deprecated` tag |
| **中等** | 8-28 | 每个可选属性末尾的 `\| undefined` 是冗余噪音 / redundant noise on every optional property |
| **低** | 37-55 | `LibrarySlot` 与 `PlaybackContext` 重复字段命名不一致：`trackIndex` vs `currentTrackIndex` / duplicate fields with inconsistent naming |
| **低** | 57-69 | `createEmptySlot` 工厂函数不应放在类型定义文件中 / factory function doesn't belong in a types file |

### `index.tsx` (22 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **中等** | 7, 12-13 | 直接使用 `console.error` 而非 `logger` 服务 / uses `console.error` instead of logger service |

### `App.tsx` (605 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **严重** | 82-120 | `usePlayback` 返回 22 个值 — hook 接口不可维护 / 22 returns — unmanageable |
| **严重** | 147-166 | `useImport` 接收 12 个位置参数 / 12 positional params |
| **严重** | 283-306 | `useShortcuts` 接收 16 个位置参数 / 16 positional params |
| **重要** | 476-504 | 向 `LibraryView` 传递 28 个 props — 极端的 prop drilling |
| **重要** | 394-601 | 200+ 行 JSX 大量使用内联样式 / 200+ lines of JSX with heavy inline styles |
| **重要** | 550-600 | 未保存更改对话框内联在 App.tsx 中 — 应抽取为 `ConfirmNavigationDialog` 组件 |
| **重要** | 251-281 | `handleReorderTracks` 包含复杂索引计算 — 应抽取为纯工具函数 |
| **中等** | 29-41 | `declare global` 增强应放在 `.d.ts` 文件中 / should live in a `.d.ts` file |
| **中等** | 1 | `import React` 在 `react-jsx` 转换下无实际用途 / unused with react-jsx transform |
| **中等** | 43 | 使用 `React.FC` — 编码规范建议避免 / style guide says avoid |
| **低** | 72-73 | `slotsRef` 模式表明状态管理已超出 hooks 能力范围 / indicates state management has outgrown hooks |

### `components/LibraryView.tsx` (1,487 行 / lines — 严重 / CRITICAL)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **严重** | 全文 | 1,487 行 — 必须拆分为专注组件 / must be split into focused components |
| **严重** | 260-278 | 自定义虚拟滚动实现，应使用 `@tanstack/react-virtual` / custom virtual scroll, use a library |
| **严重** | 1098-1196 vs 1305-1393 | 两份几乎相同的曲目列表渲染代码，仅有细微样式差异 / two near-identical copies of track list rendering with subtle styling differences |
| **严重** | 431-556 | 两份几乎相同的高亮更新 effect（行 431-473 和 485-556）/ two near-identical highlight update effects |
| **重要** | 1193 vs 1334 | 默认模式使用主题感知内联样式；分类模式使用硬编码颜色如 `rgba(239, 68, 68, 0.1)` 和 `text-yellow-400` — 不一致 / default mode uses theme-aware styles; category mode uses hardcoded colors |
| **重要** | 1420-1478 | 两个内联确认弹窗 — 提取为组件 / extract to components |
| **中等** | 344 | `useEffect` 使用 `eslint-disable-line` 压制合法依赖警告 / suppresses legitimate dependency warning |
| **中等** | 536-542 | `setTimeout` + `retryCount < 30` + 递增延迟 — 魔法数字，最长可能重试 7.5 秒 / magic numbers, up to 7.5s of retries |
| **低** | 249 | `overscan = 6` 硬编码 / hardcoded |

### `components/FocusMode.tsx` (1,114 行 / lines — 严重 / CRITICAL)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **严重** | 全文 | 1,114 行 — 包含三套独立的动画系统：Canvas 背景渐变过渡、RAF currentTime 轮询、基于贝塞尔曲线的自定义物理歌词滚动 / contains THREE separate animation systems |
| **重要** | 16-22 | `hexToRgb` 从 `Controls.tsx` 复制 / duplicated from Controls.tsx |
| **重要** | 10-13 | `decodeHtmlEntities` 每次调用创建 DOM `textarea` 元素 — 应缓存 / creates DOM element on every call — cache it |
| **中等** | 93-106 | `canvasOpacity` 状态和 `canvasOpacityRef` 同时追踪同一值 — 双状态维护 / dual state tracking |
| **低** | 1102-1105 | `React.memo` 比较器使用 0.5 秒阈值 vs `Controls.tsx` 的 1 秒 — 不一致 / inconsistent threshold |

### `components/Controls.tsx` (253 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **中等** | 33-39 | `hexToRgb` 与 `FocusMode.tsx` 重复 / duplicated |
| **中等** | 209-248 | 自定义 `React.memo` 比较器检查 20 个条件 — 极其脆弱 / checks 20 conditions — extremely brittle |
| **中等** | 44 | `forceUpdateCounter` 和 `audioRef` 使用 `_` 前缀暗示未使用，但 `audioRef` 实际在第 65 行被使用 / `_` prefix misleading |
| **低** | 130, 141 | 内联 `onMouseEnter`/`onMouseLeave` 处理重复 6+ 次 / same pattern repeated 6+ times |

### `components/Sidebar.tsx` (253 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **严重** | 13 | `currentView` 和 `viewMode` 是相同类型的独立 props。`viewMode` 被解构为 `_viewMode`（未使用）— 概念重复 / duplicate concepts |
| **重要** | 68-141 | 四个导航按钮结构几乎相同 — 应使用配置数组映射渲染 / should use a config array |
| **重要** | 164-212 | 设置/皮肤按钮重复相同的内联样式模式 / repeated inline style pattern |

### `components/BrowseView.tsx` (795 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **重要** | 225-226 | 重复的 `logger.error` 调用 / duplicated error logging |
| **重要** | 514-515 | 同样的重复 logger.error / same duplication |
| **中等** | 166 | `err: any` — 应使用 `unknown` 并窄化类型 / use unknown and narrow |
| **中等** | 37-78 | `sanitizeDownloadFileName` 和 `parseLRCLyrics` 与 `metadataService.ts` 中的版本重复 / duplicated from metadataService.ts |
| **中等** | 405-426 | `lyricsPromise` 直接使用 `window.electron?.getQQMusicLyrics` — 绕过 `DesktopAPI` 抽象层 / bypasses DesktopAPI abstraction |
| **低** | 92 | `cookiePromptShown` 使用 `sessionStorage` — 每次会话都会重新提示 / re-prompts every session |

### `components/MetadataView.tsx` (616 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **中等** | 349-467 | `renderMetadataField` 118 行包含三层嵌套条件 — 过于复杂 / too complex |
| **中等** | 305-346 | `renderDialog` 与 `App.tsx:550-600` 的对话框结构重复 / duplicated dialog structure |
| **低** | 36 | `stashedMetadata` 永不清除，会无限增长 / never cleaned up, will grow unbounded |

### `components/SettingsView.tsx` (401 行 / lines)

相对干净 / Relatively clean.
- **低** / LOW: `inputStyle`、`inputFocus`、`inputBlur`（行 146-158）每次渲染都会重新创建焦点/失焦函数

### `components/ThemeView.tsx` (338 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **重要** | 103-149 | `getThemeTagKey` 包含 50 条中英文双语标签映射 — 主题标签应使用语言键而非硬编码双语查找表 / theme tags should use language keys |
| **中等** | 53-92 | `applyThemeStyles` 与 `App.tsx:342-388` 完全重复 / exact duplicate |

### `components/ErrorBoundary.tsx` (54 行 / lines)

干净 / Clean.
- **低** / LOW | 24: 使用 `console.error` 而非 `logger` 服务

### `components/TitleBar.tsx` (218 行 / lines)

干净，组件职责明确 / Clean, well-focused.
- **低** / LOW: `as React.CSSProperties` 类型断言用于 WebkitAppRegion 非标准 CSS

### `hooks/usePlayback.ts` (515 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **重要** | 361 | 核心 `useEffect` 有 13 层嵌套，在单个 effect 中处理 WebDAV 流式播放、懒加载文件加载和直接音频 URL 播放 / 13 nesting levels handling WebDAV, lazy loading, and direct URL in one effect |
| **中等** | 289-337 | WebDAV 播放逻辑嵌入通用播放 hook 中 / WebDAV logic embedded in general hook |
| **低** | 51-66 | 两个独立的 `useEffect` 处理 `initialCurrentTime` — 可合并 / could be one |

### `hooks/useLibrarySlots.ts` (280 行 / lines)

结构良好 / Generally well-structured.
- **中等** / MEDIUM | 246-279: `migrateFromLegacyFormat` 在 249 行使用 `any` 转换访问旧数据
- **低** / LOW | 85: `setActivePlaybackMode` 的类型注解过于复杂

### `hooks/useImport.ts` (693 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **严重** | 85-682 | 七个不同的导入处理函数共享相同批处理/去重模式 — 大量重复 / SEVEN import processing functions with same batch/dedup pattern |
| **严重** | 371-374 | 导入摘要日志重复打印（完全相同的 4 行打印了两次）/ exact same 4 lines logged twice |
| **重要** | 54-66 | `buildImportSettings` 依赖数组有 6 个条目 — 每次播放更改都会重建 / 6 deps, recreates on every playback change |
| **重要** | 54-66 | `handleDesktopImport` 中 buildImportSettings 回退到传入状态而非槽位数据 — 潜在数据不一致 / potential data inconsistency |

### `hooks/useShortcuts.ts` (249 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **重要** | 46-79 | 14 对 `useRef` + `useEffect` 用于陈旧闭包引用 — 应提取为 `useStableRefs` 工具 / 14 ref+effect pairs — extract to utility |
| **重要** | 202 | `focusSearch` 使用 `document.querySelector('input[type="text"]')` — 脆弱，会匹配页面上任何文本输入框 / fragile, matches ANY text input |

### `services/metadataService.ts` (895 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **重要** | 474-478 | `parseMP4` 返回空结果 — M4A 文件从自定义解析器获取不到任何元数据 / returns empty, M4A gets no metadata |
| **中等** | 36-40 | 模块级可变状态（Worker、Map 缓存）— 多实例会共享状态 / module-level mutable state |
| **中等** | 750-783 | `getAudioDuration` 创建隐藏 `Audio` 元素，2 秒超时 — 速度慢，挂起时 Audio 元素未清理 / slow, Audio element never cleaned up |
| **低** | 744 | `export { libraryStorage } from './libraryStorage'` — 文件底部的重导出令人困惑 / confusing re-export at bottom |

### `services/desktopAdapter.ts` (361 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **重要** | 53-325 | `ElectronAdapter` 是一个 272 行的透传代理。每个方法只是调用 `this.api.sameMethod()`。项目已经是纯 Electron，这个类完全没价值 — 只增加了一层间接调用 / 272-line pass-through proxy — provides zero value |
| **中等** | 163-166 | `saveMetadataCache` 更新内存缓存但不持久化到磁盘（注释说 IndexedDB 处理）— 启动时加载但通过侧通道填充 / loaded on startup, populated through side channel |
| **中等** | 329-334 | `createElectronAdapter()` 访问 `window.electron` — 但 DesktopAPI 接口要求 `platform` 为 string |

### `services/qqMusicApi.ts` (634 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **重要** | 39-43 | `declare global { interface Window { electron?: ... } }` — 与 App.tsx 中的全局声明重复 / duplicates global declaration |
| **中等** | 48-51 | `baseHeaders` 包含硬编码 Chrome 123 User-Agent — 会过时 / hardcoded, will look outdated |
| **中等** | 127 | `g_tk: 997034911` — 硬编码令牌，可能需要轮换 / hardcoded token |
| **低** | 44-45 | `declare global` 块之后有双空行 — 格式问题 / formatting |

### `services/shortcuts.ts` (375 行 / lines)

实现干净 / Clean implementation.
- **低** / LOW | 289-303: `formatKeyForDisplay` 有无操作替换（如 `'Left'.replace('Left', 'Left')`）

### `services/webdavClient.ts` (251 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **中等** | 77 | `btoa` 用于 Basic Auth 编码 — 不处理用户名/密码中的 Unicode 字符 |
| **中等** | 121 | `await getDesktopAPI()` — `getDesktopAPI` 不是异步的，`await` 多余 / getDesktopAPI is not async, await unnecessary |

### `services/logger.ts` (144 行 / lines)

干净，设计良好 / Clean, well-designed.
- **低** / LOW | 108-110: `withScope` 返回 `ScopedLogger`，但大部分代码手动添加 `[ComponentName]` 前缀而不使用作用域日志

### `hooks/useWebDAV.ts` (457 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **重要** | 347-420 | `loadFullMode` 与 `loadWebDAVFiles` 的全量模式分支几乎相同 — 70+ 行重复的元数据批量获取逻辑 / 70+ lines of duplicated batch-fetch logic |
| **中等** | 216-345 | `loadWebDAVFiles` 129 行，嵌套深 / 129 lines, deeply nested |
| **低** | 130-139 | `saveMetadataCache` 逐条保存 — 可以批量 / saves one at a time, could batch |

### `hooks/useLibraryLoad.ts` (209 行 / lines)

| 严重度 | 行 | 问题 |
|:---:|:---:|---|
| **重要** | 152-208 | 四个独立的 `useEffect` 用于持久化 — `beforeunload` 处理器（194-208）与防抖保存（167-175）存在竞态条件 / beforeunload handler race-conditions with debounced save |
| **中等** | 40-150 | `loadAndRestoreLibrary` 110 行，混合了解析、验证、缓存初始化和恢复 / mixes parsing, validation, cache init, and restore |

### `electron/main.ts` (40 行 / lines)

干净的入口点 / Clean entry point.
- **低** / LOW | 17: `disable-gpu-sandbox` 是安全相关标志 — 确认是否有意为之

### `index.css` (39 行 / lines)

干净 / Clean.
- **低** / LOW | 28-38: 全局移除所有焦点轮廓 — 对键盘用户来说是可访问性问题 / accessibility problem for keyboard users

---

## 跨文件问题 / Cross-Cutting Issues

### 1. 代码重复 / Code Duplication

| 重复内容 / Duplicated Item | 出现位置 / Locations |
|---|---|
| `hexToRgb` | `Controls.tsx:33-39`, `FocusMode.tsx:16-22` |
| `applyThemeStyles` (CSS 变量设置) | `App.tsx:341-388`, `ThemeView.tsx:53-92` |
| 未保存更改确认对话框 | `App.tsx:550-600`, `MetadataView.tsx:305-346` |
| `formatTime` | `Controls.tsx:27-31`, `FocusMode.tsx:309-314`, `BrowseView.tsx:556-561` |
| 语言订阅模式 (`i18n.subscribe`) | 9 个组件中完全相同 / identical in 9 components |
| 主题订阅模式 (`themeManager.subscribe`) | 8 个组件中完全相同 / identical in 8 components |

**建议 / Recommendation:**
- `hexToRgb`、`formatTime` → 共享工具函数 / shared utility
- `applyThemeStyles` → 移入 `themeManager` / move into themeManager
- i18n/theme 订阅 → 创建 `useI18n()` 和 `useTheme()` hooks
- 确认对话框 → 创建 `ConfirmNavigationDialog` 组件

### 2. 内联样式泛滥 / Inline Style Proliferation

几乎所有组件大量使用内联 `onMouseEnter`/`onMouseLeave` 处理悬停效果，而非 CSS `:hover` + CSS 自定义属性。这是组件行数过长的首要原因——约 40% 的组件代码只是重复的内联事件处理器。

**建议 / Recommendation:** 使用 CSS 变量 + Tailwind `hover:` 变体替代内联样式悬停处理。例如：

```css
/* 代替 / instead of: */
/* onMouseEnter={e => e.currentTarget.style.color = colors.textPrimary} */
/* onMouseLeave={e => e.currentTarget.style.color = colors.textSecondary} */

button {
  color: var(--theme-text-secondary);
}
button:hover {
  color: var(--theme-text-primary);
}
```

### 3. 缺少测试 / No Tests

尽管编码规范要求 80% 覆盖率 + TDD 流程，但项目中**没有任何测试文件**。

### 4. 缺少类型检查脚本 / No Type-Check Script

`package.json` 中没有 `tsc --noEmit` 命令。TypeScript 配置严格但没有 CLI 验证方式。

### 5. `ElectronAdapter` 透传层无价值 / Worthless Pass-Through Layer

`services/desktopAdapter.ts` 中的 `ElectronAdapter` 类（272 行）是一个纯透传代理——每个方法只是调用 `this.api.sameMethod()`。由于项目已是纯 Electron，这个类提供了零抽象价值，只增加了不必要的间接层。

---

## 问题严重度汇总 / Severity Summary

| 严重度 / Severity | 数量 / Count |
|---|---|
| **严重 / CRITICAL** | 14 |
| **重要 / MAJOR** | 23 |
| **中等 / MEDIUM** | 27 |
| **低 / LOW** | 22 |

### 最优先修复项 / Top Priority Fixes

1. 拆分 `LibraryView.tsx`（1,487 行）为 8-10 个专注组件 / Split into 8-10 focused components
2. 引入状态管理库（Zustand 或 Jotai）替代 prop drilling / Introduce state management
3. 将 `audioUrl` 改为可选类型 / Make `audioUrl` optional
4. 创建 `useI18n`、`useTheme` hooks 消除订阅模式重复 / Create shared hooks
5. 将 `hexToRgb`、`formatTime`、`applyThemeStyles`、确认对话框提取为共享代码 / Extract shared utilities
6. 移除 `ElectronAdapter` 透传层或赋予其实际职责 / Remove or give real purpose
7. 添加 `tsc --noEmit` 脚本到 `package.json` / Add type-check script
8. 使用 CSS `:hover` 替代内联悬停事件处理器 / Replace inline hover handlers with CSS
