# 页面渲染内存优化分析（Windows 优先）

> 分析日期：2026-09-08
> 范围：渲染进程（DOM / 合成层 / 图片解码 / 画布）与直接影响渲染内存的主进程路径
> 方法：源码审计 + 复用仓库已有 benchmark 数据（`test-results/memory/`）；**未在 Windows 实测**，
> Windows 相关结论均标注为"待验证"，并给出验证步骤。
> 本文只做分析，不含代码改动。

## 0. TL;DR — 建议先做的 6 件事

| # | 优化 | 平台 | 预计收益 | 状态 |
|---|------|------|----------|------|
| 1 | 在线封面 / 专辑·艺术家侧栏封面改用 `toCoverThumb()` 并补 `loading="lazy" decoding="async" width/height` | 全平台 | 单次浏览省 10–77MB 解码位图；500 专辑 rail 省 ~32MB | ✅ 已实施 |
| 2 | 删除 `Sidebar` 上被不透明背景完全遮住的 `backdrop-blur-md`，删除面板 `::after` 的重复 `backdrop-filter` | 全平台（**Windows 收益最大**） | 去掉常驻全高模糊层 + 面板模糊成本减半 | ✅ 已实施 |
| 3 | Focus 背景的两张扩边临时画布在过渡结束后立即释放 | 全平台 | 6.4MiB@1200×800 / 14.8MiB@2560×1440 | ✅ 已实施 |
| 4 | 滚动时不再每个事件写 `slots.scrollPosition`（滚动中只写 ref，停稳后提交，切槽/关闭读 ref） | 全平台 | 消除每滚动事件的全应用重渲染与 GC 抖动 | ✅ 已实施 |
| 5 | Focus 合成层治理 | 全平台（**Windows 放大**） | — | 🔬 已实测：初版推测被推翻，见 §3 P1-3 |
| 6 | 背景 canvas 按 DPR 计算 backing store，并去掉 100px overscan | 全平台（**Windows 150% 缩放关键**） | 层边界 5.6→3.84MPx@DPR2；修复高 DPI 模糊 | ⏳ 待做（见 §3 P1-3 下一步） |

> 实施记录与验证命令见文末 §8。

---

## 1. 现状与实测基线

### 1.1 渲染架构速览

- **曲库列表**：已虚拟化（`src/hooks/useLibraryVirtualScroll.ts:65` 阈值 40、`:52` overscan 6），行组件已 `memo`（`src/components/LibraryTrackRow.tsx:36`）。
- **Focus Mode**：**无 WebGL**。背景是 5 张 canvas 2D（`src/components/FocusMode.tsx:242-250, 268-270, 330-331`），歌词是 DOM——legacy 用 React 行（`FocusLegacyLyrics.tsx`），AMLL 用 `DomLyricPlayer`（DOM 渲染器，非 Pixi）。AMLL chunk 里含 Pixi 代码但从不实例化。
- **封面**：`cover://` 协议 + `?size=` 缩略图（`electron/protocols/coverProtocol.ts:9-11, 182-220`），带 `?v=` 的内容哈希走 `immutable` 缓存（`electron/ipc/coverHandlers.ts:41-42`）。
- **音频**：`audio://` Range 流式（`electron/protocols/audioProtocol.ts:99-128`），切歌/卸载清空 `<audio>` 并 `load()`（`src/hooks/usePlayback.ts:151-158`），`preload="metadata"`（`src/App.tsx:448`）。**这部分已经做得很好，无需再优化**。

### 1.2 已有实测数据（macOS arm64，Electron 42 / Chromium 148）

来自 `test-results/memory/package-memory-macos-arm64-2026-08-27T10-40-50-827Z.json`（打包版、真实曲库、强制 GC）：

| 阶段 | WorkingSet | JS heap | DOM 节点 | 图片解码估算 | 说明 |
|------|-----------|---------|----------|--------------|------|
| 空闲（GC 后） | 607.5MB | 18.7MB | 309 | 5.5MB | 基线 |
| Focus 打开（AMLL，GC 后） | 760.3MB (+152.8) | 22.9MB | 548 | 6.5MB | Tab +122.3、GPU +29.1 |
| Focus 退出（GC 后） | 723.1MB (+115.7) | 20.7MB | 314 | 5.5MB | Tab +84.9、GPU +29.3 |
| 第 3 轮退出（GC 后） | 680.0MB (+72.5) | 20.7MB | 314 | 5.5MB | Tab +58.4、GPU +33.4 |

关键读数：

1. **内存不在 JS 堆里**。进出 Focus 的 JS heap 只变化 2–4MB，但 Tab 进程 +85～122MB、GPU 进程 +29～34MB。这部分是合成层纹理、图片解码、partition_alloc 与 GPU 池。
2. **GPU 进程的 +29MB 进去一次就不再归还**（第 3 轮仍是 +33MB），是典型的 Chromium GPU 内存池行为。
3. **强制 GC 能回收 26–45MB**（`test-results/memory/focus-audit-2026-09-05/amll-probe-memory.json` 的 `focus-after-gc` / `post-focus-after-gc` 阶段），说明"退出后仍保留"有相当一部分是**延迟回收而非硬泄漏**。仓库对象图中未找到能解释该量级的强引用，唯一真实泄漏（AMLL 0.5.2 的 `ResizeObserver`）已在 `src/components/focus-mode/FocusAmlLyrics.tsx:29-34` 修复并有单测。
4. **合成层数量是采样时机的函数，不是稳定的内存指标**：旧层探针在进入 Focus 后固定 1.5s 采样，得到 247–297 层；改为等待层数稳定后采样，同一份代码只有 69 层（`test-results/memory/layer-probes/`）。动画进行中大量歌词行被合成，动画预算生效后回落。详见 §3 P1-3——那里也记录了"AMLL 负边距导致图层爆炸"这一初版推测被 A/B 实测推翻的过程。

> 注意：macOS 的 working set 会重复计入共享页，且内存压缩使绝对值不可跨平台比较；**Windows 上应看 `privateBytes`**（`test/e2e/electron.memory.spec.ts:480-488` 已按平台选择主指标）。

### 1.3 判断口径

- **留存**看强制 GC 后的 `post-focus-after-gc`，不看 `natural`。
- **多轮斜率**比单轮差值更能区分"一次性预热"和"每轮泄漏"：现有数据是一次性增长到 +70～115MB 后趋稳，不是线性泄漏。
- **解码位图** = `W×H×4`，不含 GPU 纹理与合成器副本；`cover://?size=` 会 snap 到 {128,256,512}（`coverProtocol.ts:9-11`），所以 40px 行封面实际解码 128×128 = 64KB/张。

---

## 2. P0：低风险、收益明确

### P0-1 在线封面与专辑 rail 封面严重过采样

| 位置 | 问题 | 影响 |
|------|------|------|
| `src/components/BrowseView.tsx:379-383` | 在线列表直接 `<img src={song.coverUrl}>`，无 `toCoverThumb`、无 `loading`、无尺寸 | 网易 CDN 返回 800×800（`src/services/neteaseMusicApi.ts:125-129` `?param=800y800`）→ 2.56MB/张，30 行 ≈ 77MB 解码位图，而 CSS 显示仅 ~160px |
| `src/components/search/SearchResultCards.tsx:138-142` | 同上 | 最多 8 张在线卡，同样 800px 直出 |
| `src/components/LibraryView.tsx:1124-1130 / 1147-1153` | 专辑/艺术家 rail 用了 `toCoverThumb(...,128)`，但**无 `loading="lazy"` / `decoding` / `width/height`** | 128×128×4 = 64KB/张；500 专辑 ≈ 32MB，2000 专辑 ≈ 128MB。该 rail 是 `overflow-y-auto` 滚动容器（`LibraryView.tsx:1103-1106`），lazy 本可生效 |

**建议**：`toCoverThumb(song.coverUrl, 128)` 已支持网易 `param=N`、QQ `T00xR` 尺寸 snap、picsum（`src/services/coverUrl.ts:71-117`），直接复用；并补 `loading="lazy" decoding="async" width={40} height={40}`。专辑数 >200 时给 rail 加 `content-visibility:auto; contain-intrinsic-size:auto 40px`（全仓库目前 `contain` / `content-visibility` 命中 0 处）。

### P0-2 常驻/重复的 backdrop-filter

| 位置 | 问题 | 说明 |
|------|------|------|
| `src/components/Sidebar.tsx:408` | `backdrop-blur-md` + `:413` 不透明 `backgroundColor: var(--theme-background-sidebar)` | 5 个预定义主题的 sidebar 色全是不透明 hex（`src/services/themes/predefinedThemes.ts:22/65/108/151/194`）→ 模糊结果被自身背景完全盖住，**纯浪费**；全高×208px 常驻，拖拽调宽时每帧重建该层 |
| `src/styles/components.css:77-78` + `:94-95` | `.app-side-panel` / `.app-inline-popover` 本体和 `::after` **各做一次** `backdrop-filter: blur(34px)` / `blur(44px)` | 同一区域两次大半径模糊；建议删掉 `::after` 上的那一份（保留渐变高光），目视确认无视觉差异 |
| `src/index.css:972-986` + `src/components/Controls.tsx:60` | `frosted-bar` / `frosted-header` 全宽 `blur(20px)`；`glassUI` 并非恒 false | `src/hooks/useGlassUI.ts:9` 注释称已停用，但 `src/services/settingsManager.ts:80` 仍从持久化读取 `glassUI`。曾经开启过的用户会长期多背 2 个全宽模糊层。建议在 `loadFromStorage` 强制 `false`，落实 deprecated 契约 |

### P0-3 Focus 背景扩边临时画布常驻整个会话

`src/components/FocusMode.tsx:236-250` 里 `padding = ceil(bgBlurRadius × 0.5 × 4)`（默认 80 → 160px），于是 source / filtered 两张扩边画布分别比输出大 320px：

- 1200×800 窗口：source/filtered 各 1020×820 = 3.19MiB，output/frame/prepared 各 1.34MiB，**5 张合计 10.39MiB**，其中两张扩边画布 6.4MiB。
- 2560×1440 窗口：合计 **27.7MiB**，其中扩边画布 14.8MiB。

这两张扩边画布只在 `prepareBackdrop()` 内使用，但 ref 一直持有到卸载才 `width=0;height=0`（`:716-733`）。**建议**：过渡结束（`transitionProgressRef.current === 1` 且 alpha 到位）后立即清零这两张画布，下次 `prepareBackdrop` 再分配。

> 正面确认：canvas 的卸载释放是完整的（`:710-739`），rAF/listener/timer/observer 也都有清理；这里不是泄漏，是"持有过久"。

### P0-4 滚动事件驱动全应用重渲染

`src/components/LibraryView.tsx:584-589` 的 `handleScroll` 每个滚动事件都：

1. `setScrollTop(newScrollTop)`（本组件重渲染，虚拟化计算）；
2. `onScrollPositionChange?.(newScrollTop)` → `src/hooks/useLibrarySlots.ts:124-129` `setActiveScrollPosition` → 新的 `slots` 对象 → `App` → `AppShell` → `LibraryView` / `Sidebar` 全树重渲染。

行组件有 `memo` 兜底，滚动中 props 不变，所以**行不会重渲染**（这是已经做对的部分）；但每个滚动事件仍会产生一次全树 commit + 新 `slots` 对象 + 新 `visibleTracks` 数组。Windows 上配合 125Hz 鼠标 / 高刷屏，这会变成每秒上百次 commit 与 GC 抖动。

**建议**：滚动中只写已存在的 `lastScrollTopRef`（`src/stores/libraryStore.ts:19/41`），在切槽、卸载、`onScrollPositionChange` 防抖后再落库；`reorderTracksHandler` 改从 `slotsRef.current` 读，避免依赖 `slots` 身份（`src/controllers/useLibraryController.ts:208/230`）。

### P0-5 File 导入路径把整首歌并发读进渲染进程（Web/回退路径）

`src/services/metadataService.ts:125` `const buffer = await file.arrayBuffer()`，随后 transfer 给 worker；`src/hooks/useImport.ts:277-286` 用 `Promise.all` 并发处理一个批次，`BATCH_SIZE = 10`（`:630` / `:737`）。10 首 50–100MB 的 FLAC 意味着**瞬时 0.5–1GB** 的 ArrayBuffer（transfer 后 worker 消息队列里仍然全部存活）。

Electron 下拖放/原生对话框走的是路径导入（`src/components/LibraryView.tsx:706-715` 的 `getPathForFile`、`processDesktopFilePathBatch`），所以**桌面主流程通常不触发**；但 `<input type="file">`（`src/components/AppShell.tsx:211`）和浏览器模式仍会走 File 路径。**建议**：把批大小降到 2–3（低风险先行），长期改为 Range 头解析。

### P0-6 搜索：每键全库 pinyin + 收起后仍挂载

- `src/components/SearchBox.tsx:2` 顶层 `import { match } from 'pinyin-pro'`（词典随 AppShell 常驻），`:27-39` 每次按键都重新 `join` 4 个字段 + 2 次 `normalize` + 2 次正则，`:79-87` 对全库 `filter().slice(0,8)` 无早退。10k 曲库 ≈ 每键 40k 次字符串分配。
- `SearchBox.tsx:134-139` 点击外部只 `setIsFocused(false)`，`:220-304` 结果容器仍挂载（CSS 仅 `visibility:hidden; opacity:0`，`index.css:569/576`）→ 最多 24 张封面保持解码（local/cloud 用 `thumbSize=256`，256KB/张）。

**建议**：预算每首的 normalized 搜索串（随 `tracks` 变化），命中数达到上限即早退；`pinyin-pro` 改动态 `import()`（首次聚焦搜索框时加载）；结果容器改为 `{isExpanded && ...}`。

---

## 3. P1：收益大，但需要验证或改动更大

### P1-1 Windows 窗口材质：acrylic + 非不透明合成（Windows 特有，待验证）

`electron/windowManager.ts:78-82`：

```ts
transparent: isMacOS || process.platform === 'linux',   // Windows 上 false
...(isWindows ? { backgroundMaterial: 'acrylic' as const } : {}),
...(isWindows ? { backgroundColor: '#00000000' } : {}),
```

配合 `src/index.tsx:11-12` 给 `<html>` 加 `data-window-effect="acrylic"`、`src/index.css:48-52` 把 `html/body/#root` 背景设为透明。

需要在 Windows 上确认的几点：

1. **acrylic 的系统要求**：Electron 的 `backgroundMaterial` 依赖 Windows 11 / Windows 10 22H2+。在不支持的版本、或在"设置 → 个性化 → 颜色 → 透明效果"被关闭时，材质会静默失效，而 WebContents 背景仍是透明的——需要确认此时是否出现"桌面透出/纯黑"的降级表现。
2. **独立翻转（independent flip）**：非不透明窗口通常无法走 DWM 的独立翻转/硬件覆盖路径，DWM 必须每帧合成窗口内容。这会把成本从 GPU 显存转移到系统内存与 DWM 进程，**在任务管理器里看不到，但会体现在合成帧时间上**。
3. **收益面很小**：`AppShell` 的 `<main>` 有不透明渐变（`AppShell.tsx:160-164`）、`Sidebar` 不透明、`Controls` 半透明——真正透出 acrylic 的只有顶部 ~38px 标题栏条（`TitleBar.tsx:90` `bg-transparent`）与页面留白。**即：为了很小的视觉收益，付出了整窗非不透明合成的代价。**
4. **与页内 `backdrop-filter` 叠加**：系统 acrylic 与页内玻璃层是两套模糊，Windows 上页内 `backdrop-filter` 还需要一次 backdrop 读回与离屏渲染。

**建议（按风险从低到高）**：

- 先做一个设置开关，让 Windows 用户可以关掉 acrylic（回退到不透明窗口 + 不透明标题栏条），再对比帧时间与 `dwm.exe` 内存。
- 如果保留 acrylic：确认 `backgroundMaterial` 生效的检测方式（Windows 版本 + 透明效果开关），未生效时用不透明背景兜底。

### P1-2 Windows DPI 缩放是最大的倍数放大器（Windows 特有，待验证）

Windows 上 125% / 150% 缩放非常普遍，Chromium 的所有合成层、`backdrop-filter` 离屏 surface、图片解码目标都按 DPR 放大：**面积按 DPR² 增长**（150% → 2.25×）。同一套图层在 2560×1440 @150% 下，单个全窗口层就是 3840×2160×4 ≈ 33MB。

与之相关的一个**确定的实现缺陷**：Focus 背景 canvas 完全不感知 DPR——

```ts
// src/components/FocusMode.tsx:305-308
const cssWidth  = Math.max(1, window.innerWidth  + BACKDROP_OVERSCAN_PX * 2); // +200
const cssHeight = Math.max(1, window.innerHeight + BACKDROP_OVERSCAN_PX * 2);
const width  = Math.max(1, Math.ceil(cssWidth  * BACKDROP_RENDER_SCALE));     // ×0.5
const height = Math.max(1, Math.ceil(cssHeight * BACKDROP_RENDER_SCALE));
```

层探针显示：canvas 合成层是 2800×2000（5.6MPx），而 backing store 只有 700×500（1.34MB），即 4× 上采样——**在高 DPI 下背景会更糊，同时合成层边界仍按 CSS 尺寸放大**。

**建议**：backing store 改为 `cssWidth × min(dpr, 2) × scale` 之类的 DPR 感知公式（保持离屏 blur 的廉价优势），并把 `BACKDROP_OVERSCAN_PX` 100 降到 0——边缘透明问题已由 `drawEdgeExtendedCover` 的边缘延伸解决（`:257`）。

### P1-3 Focus 合成层（已实测，结论与初版分析相反）

用新增的层探针（`test/e2e/electron.focus-layers.spec.ts`，报告落在 `test-results/memory/layer-probes/`）在同一台机器上做了 A/B，**实测推翻了两条初版推测**：

| 观测 | 结果 |
|------|------|
| 旧探针在进入 Focus 后固定等 1.5s 采样 | 247–297 层 / 37.6–38.1MPx |
| 新探针等待层数稳定后再采样（同一份代码） | **69 层 / 35.4–35.6MPx** |
| 覆盖 AMLL 的 `margin: -1em; padding: 1em`（去掉负边距重叠） | 仍是 **69 层 / 35.35MPx**，与未覆盖一致 |

结论：

1. **"AMLL 逐词图层爆炸"是采样时机造成的假象**。歌词滚动/入场动画进行中时，大量行处于 active/prepare 状态而被合成；等动画预算（`src/components/focus-mode/focusAmlAnimationBudget.ts`）把静态行的 `will-change` 与 mask 清掉后，层数回落到 69。**初版把 `margin: -1em` 的 `Overlap` 当成主因是错的**，A/B 显示覆盖它没有任何收益，且会改变行距（已回退，未进入代码）。
2. **层面积由少数结构性大层主导，不是几百个小层**。Focus 态下最大的层是：backdrop canvas `2800×2000`（5.6MPx）、`.focus-mode-overlay`（3.84MPx）、`data-focus-backdrop-overlay` 渐变层（3.84MPx）、两个 `focus-lyrics-viewport` 层（共 1.84MPx）、`.amll-lyric-player`（0.79MPx）、FocusControls 玻璃层（0.77MPx）。把 `fixed` 改成 `absolute` 并不会让渐变层并入父层（实测仍单独占 3.84MPx，已回退），因为它必须画在 composited canvas 之上。
3. **层面积 ≠ 内存**：canvas 层的 5.6MPx 只是它的 CSS 盒子，真正的纹理是 700×500 backing store；`mix-blend-mode: plus-lighter` 的 blend group 离屏缓冲不计入层统计（`.amll-lyric-player` 824×960 @DPR2 ≈ 12.6MB），仍值得单独用 privateBytes 验证。
4. 探针夹具（13 行歌词、DPR2、1200×800 窗口）实测 Focus 增量：**Tab +37MB、GPU +9MB**（GC 后中位数）；退出后 Tab 仍 +32MB。打包版真实曲库基准的增量更大（+85～122MB），说明夹具尚未复现最坏情况，需要用真实曲库在 Windows 上复测。

仍然成立的项：

- **AMLL 每行一个 `filter: blur()`**：`amll-core.mjs:3423` 每帧给每个 `.FmKaba_lyricLine` 写 `filter: blur(...)`（上限 5px），`core/dist/style.css` 的 wrapper/line 各带 `will-change`；静态行已有覆盖，但 wrapper/line 自身没有。
- **legacy 渲染器全量挂载**：`FocusLegacyLyrics.tsx:342-363` 无虚拟化，每行 `filter: blur(inactiveBlur)` + `transform: scale()`（`FocusLyricRow.tsx:86-92`），容器还有 `will-change-transform`（`:336`）。成本随歌词行数线性增长，而现有 legacy 基准只跑了 3 行（`test/e2e/electron.memory.spec.ts:317` 默认值），**100 行的情况仍未测量**。
- **背景 canvas 与 DPR**：`FocusMode.tsx:305-308` 只用 `innerWidth × 0.5`，不感知 DPR；层边界 2800×2000 而 backing store 只有 700×500。

**下一步实验（按性价比）**：

1. 用 `HeapProfiler` + privateBytes 单独 A/B `mix-blend-mode: plus-lighter` → `normal`，验证 blend group 缓冲的真实成本（视觉上是歌词与背景的加色发光，属于设计选择，需产品确认）。
2. 补 100 行 legacy 基准（`MEMORY_BENCHMARK_LYRICS_RENDERER=legacy MEMORY_BENCHMARK_LYRIC_LINES=100`），再决定是否虚拟化 legacy 行。
3. 背景 canvas 的 DPR 与 100px overscan：overscan 部分被 `overflow-hidden` 裁掉，去掉它是布局无感的（但要覆盖窗口快速缩放的边界情况）。

### P1-4 整库歌词/逐行歌词常驻 React state

`src/hooks/useLibraryLoad.ts:147-151`（local）与 `:168-193`（cloud）把每首歌的 `lyrics`、`syncedLyrics`、`wordLyrics` 全量读进 slots state；`src/services/librarySerializer.ts:15-18` 又原样写回。列表行完全不用这些字段。

估算：50 行 `syncedLyrics` ≈ 5–10KB/首 → 5k 首 ≈ **25–50MB JS heap**；`wordLyrics` 单首上限 500KB（`src/services/dataValidator.ts:36`）。

仓库里已有正确做法的先例：`src/controllers/usePlayerController.ts:540-568` 对 provider 轨道只保留 current±1 三首的歌词（playlist 槽专用）。**建议**分阶段：先只清 `syncedLyrics` + `wordLyrics`（保留 `lyrics` 字符串），持久化时从 `metadataCacheService` / IndexedDB 回填，避免丢数据。

### P1-5 MetadataView 左栏全量渲染

`src/components/MetadataView.tsx:517-546` 对 `libraryTracks.map()` 全量渲染，每行 ~5 个节点 + 3 个内联闭包；`:421` / `:367-371` 每次输入都 `setSelectedTrack` → 整表重渲染。10k 曲库 ≈ 50k DOM 节点，每次按键 30k 闭包分配。**建议**：抽 `memo` 行组件 + 窗口化（可复用 `useLibraryVirtualScroll`），或先渲染前 200 行 + sentinel。

### P1-6 主题切换给 `body *` 全量加过渡

`src/index.css:55-60`：

```css
:root.theme-is-transitioning body,
:root.theme-is-transitioning body * {
  transition-property: background-color, color, border-color, box-shadow, fill, stroke, opacity;
  transition-duration: 360ms;
}
```

切换主题的 420ms 内（`src/services/themeManager.ts:260-264`）整棵树都参与过渡，所有 `backdrop-filter` 层逐帧重新采样/重栅格。**建议**收窄到颜色类属性，或用白名单选择器。

### P1-7 封面缩略图在主进程同步解码

`electron/protocols/coverProtocol.ts:191-217`：

- `nativeImage.createFromPath(coverPath)` 在主进程**同步解码整张原图**（4000×4000 ≈ 64MB 临时 RGBA），再 `resize` 一份；
- 每次写缩略图都 `writeFileAtomically` → `fsyncSync`（`:76-80`），Windows 上会阻塞主线程；
- 没有并发上限。快速滚动 / Focus 切歌时多个 `cover://` 请求同时到达，主进程会出现解码内存尖峰与卡顿。

**建议**：加一个小的并发队列（或 LRU 复用已解码 `nativeImage`），把 `fsyncSync` 改为可选/批量，长期可移到 `utilityProcess` 里做，让临时解码内存不落在 Browser 进程（Windows 用户看任务管理器主要看主进程）。

### P1-8 worker 元数据缓存保留 50 份封面 ArrayBuffer

`src/services/metadataService.ts:43-45` 的 `metadataWorkerCache` 上限 50，缓存值里含 `coverData: ArrayBuffer`（`:36`，由 worker transfer 回传）。常见内嵌封面 0.2–1MB，3000×3000 PNG 可 >10MB → 常驻 **10–50MB**，且只有 `terminateMetadataWorker()`（`:95-107`）才清空。**建议**：缓存里丢弃 `coverData`（只留文本元数据），或把上限降到 8。

### P1-9 AMLL 因 track 对象身份变化而全量重建

`src/components/focus-mode/FocusAmlLyrics.tsx:67` 的 `useMemo(..., [track])` 以整个 track 对象为 key，而 `src/hooks/usePlayback.ts:259-266` 在 `loadedmetadata` 时会替换 track 对象 → `amll-react` 的 `setLyricLines` → AMLL 内部 2 次 `structuredClone`（`amll-core.mjs:2955-2956`）+ 重建全部 `LyricLineEl`（`:4684-4703`）。每次曲目加载多一次全量重建尖峰。**建议**：依赖改为 `[track.id, track.syncedLyrics, track.lyrics, track.title, track.artist, track.duration, track.source]`。

### P1-10 其他值得排期的项

| 项 | 位置 | 说明 |
|----|------|------|
| Focus 全屏 `backdrop-blur-sm` | `FocusBackdrop.tsx:17-22`，`FocusMode.tsx:579-581` | 进入时挂载、~1s 后移除（已做得对）；但**每次切歌也会重新挂载**（`blurUnderlyingViewForTrackChange`），Windows 上是一秒级的全屏 render target 分配高峰。建议过渡期用预模糊静态层或降到 4px |
| FocusControls 玻璃层 | `FocusControls.tsx:65-74`、`index.html:32-35` | `opacity: 0` 隐藏时 `backdrop-filter` 仍在（探针里是一个 1408×546 的 BackdropFilter 层）。隐藏动画结束后置 `none` |
| 主进程 IPC 快照 | `useLibraryLoad.ts:633-656`、`libraryStorage.ts:122-136`、`desktopAdapter.ts:203-206` | 每次曲库变更构造 2–3 份整库副本并做 structured clone；含全部歌词时 10–20MB/次。建议剥离未变更歌词、延长 debounce |
| 启动全量读 IDB 再裁到 300 | `metadataCacheService.ts:54-56` + `:17` | 启动峰值 = 整库歌词对象图；建议游标/分页读取 |
| `useSystemLyrics` 20Hz | `useSystemLyrics.ts:185-196`、`systemLyricsState.ts:95-98` | 50ms 一次 `JSON.stringify` + 每词重建前缀；建议按 `line.words` 做 WeakMap 缓存 |
| netease 缓存无上限 | `neteaseMusicApi.ts:84-85, 196-199, 249` | `detailsCache` / `albumCoverCache` 随浏览历史单调增长，建议 LRU |

---

## 4. P2：清理项清单

- `TrackCover` 的 memo 比较器按引用比较 `style` 且不比较 `className`（`src/components/TrackCover.tsx:93-99`），而调用方每次新建 style 对象（`LibraryTrackRow.tsx:118-124`）→ memo 被击穿；建议 style 提为模块常量并把 `className` 纳入比较。
- `LibraryView.tsx:187-215` 的 `uniqueArtists/uniqueAlbums` 在 default 模式也无条件全库计算；建议惰性。
- `LibraryView.tsx:545-560` 的分类高亮重试链最多 30 层 `setTimeout`+rAF，cleanup 只清外层；建议统一取消。
- `FocusLyricRow.tsx:4-15` 的 `decodedLyricCache` 到 2048 才整体 `clear()`；建议降到 512 或改 WeakMap。
- `FocusLyricRow.tsx:48-51` 对**每一行**都计算 `decodedWords`（只有 active 行用得上），且每个新字符串都 `document.createElement('textarea')` 解码一次；建议只在 `isActive` 时计算，并用单个共享 textarea 或正则解码。
- `metadataCacheService.ts:17/55` 上限 300 但初始化时全量读入；建议分页。
- `getAudioDuration` 的 error 分支没有清 `src`（`metadataService.ts:850-855`，另两条路径都清了）。
- `useImport.ts:201-208` / `useLibraryActions.ts:85-92` 的 base64 解码用 `atob` + `new Array(n)`，中间数组放大 4–8×；建议 `Uint8Array.fromBase64`（需确认 Chromium 版本支持）。
- `index.css:917` 滚动条 thumb 常驻 `will-change`；`ThemeView.tsx:220/376`、`ThemePanel.tsx:135` 的 `transition-all` + hover `blur(4px)`；`LibraryToolbar.tsx:211` 关闭态仍带 `backdropFilter`；`LibraryView.tsx:965/1168` 拖放遮罩的 blur+无限 pulse。
- 字体：`public/fonts/inter/inter.css` 声明了 38 个 `@font-face`，但目录里只有 4 个 woff2（34 个 404，含被主题用作标题的 `Inter-ExtraBold.woff2`）。建议补齐或删除多余声明；顺带在 AMLL 字体栈里补 `"Microsoft YaHei UI", "Segoe UI"`，避免 Windows 上回落到与 macOS 不同的字形（`FocusAmlLyrics.css:12` 目前是 Apple/Noto 优先）。

---

## 5. 已经做对的地方（不要重复优化）

- 曲库列表虚拟化 + 行 memo：播放进度 tick 不会重渲染列表行；`rowMeasureRef` 不会导致整表重挂载（回调身份只在行高变化时改变，DOM 复用、img 不重新解码）。
- 分类模式下的曲目列表同样走虚拟化；未虚拟化的只有专辑/艺术家 rail（见 P0-1）。
- 音频：`audio://` Range 流式 + 切歌清空 `src` + `load()` + `preload="metadata"`；无下一曲预加载；无 `AudioContext`/`AnalyserNode`。
- MediaSession：action handler、artwork fetch（AbortController）、metadata/playbackState 都有释放。
- Focus：内容在退出动画后**真正卸载**（`FocusMode.tsx:885-931`），canvas backing 全部清零、rAF 全部 cancel、`preparedBackdropCache` WeakMap 重建；AMLL 的 `ResizeObserver` 泄漏已修。
- 有界缓存：`metadataCacheService` 300、worker 元数据 50、`providerLyricsCache` 12、online 槽 LRU 50、playlist 歌词窗口 3 首。
- 封面：`cover://?size=` 降采样 + `?v=` 内容哈希 immutable 缓存；`TrackCover` 有 `loading="lazy"`。
- GSAP：tween 有 `killTweensOf` / `context.revert()`，Focus 路径不涉及。

---

## 6. 验证方案

### 6.1 在 macOS 上就能做的准备

1. **扩展 memory harness 覆盖列表路径**：现有 `test/e2e/electron.memory.spec.ts` 只造 1 首曲目且只跑 Focus 循环（`:342-390`），**覆盖不到列表/搜索/MetadataView**。建议加 `MEMORY_BENCHMARK_LIBRARY_TRACKS=N` 合成大曲库（带 30 行 `syncedLyrics`、`cover://` 封面、多个 album/artist），新增阶段：`library-top` → `library-mid` → `library-album-filter` → `metadata-view` → `search-expanded` → `search-blur`。
2. **补长歌词 legacy 基准**：`MEMORY_BENCHMARK_LYRICS_RENDERER=legacy MEMORY_BENCHMARK_LYRIC_LINES=100`，验证 legacy 成本是否随行数线性增长（当前只有 3 行数据）。
3. **层探针常态化**：把 `LayerTree` + `DOM.describeNode` 的层统计并入 harness（现有 `test/e2e/electron.focus-memory.spec.ts:90-93` 已有雏形），并在 `canvasBackingBytesEstimate` 里补上 4 张离屏画布（现在只统计 `document.querySelectorAll('canvas')` 里的元素）。

### 6.2 上 Windows 后的对照步骤

1. 同一份构建、同一台机器、同一窗口尺寸，跑：
   ```bash
   npm run test:memory          # 基线
   MEMORY_BENCHMARK_LYRICS_RENDERER=legacy MEMORY_BENCHMARK_LYRIC_LINES=100 npm run test:memory
   MEMORY_BENCHMARK_CYCLES=8 MEMORY_BENCHMARK_SETTLE_MS=5000 npm run test:memory
   ```
   主指标用 `privateBytesMb`，按 `processGroups` 分别看 `Tab` 与 `GPU:GPU`；判据是 `post-focus-*` 是否阶梯式单调增长（区分一次性预热 vs 每轮泄漏）。
2. **DPI 对照**：同一 1200×800 CSS 窗口分别在 100% / 150% 缩放下跑，量化 DPR² 对全窗口层与 canvas 层的影响。
3. **窗口材质对照**：acrylic 开 / 关两组，看 `dwm.exe` 内存与合成帧时间（`chrome://gpu` + DevTools Performance）。
4. **逐项 A/B**：每次只改一项（如删 Sidebar blur、删 `::after` blur、`mix-blend-mode: normal`），记录 Tab/GPU privateBytes 与层数变化。
5. **交互式**：`npm run electron:debug`（renderer CDP :9222）→ DevTools Memory（Heap snapshot 看 `syncedLyrics` 行对象与 Detached DOM）、Layers 面板、Network 过滤 Img 验证 `loading="lazy"` 阈值；`document.querySelectorAll('img')` 的 `naturalWidth` 直接验证 P0-1 是否生效（修复前在线封面应 ≈800，修复后 128/256）。

---

## 7. 不确定性与风险

1. **Windows 绝对收益未知**：macOS 的 working set 含共享页与内存压缩，D3D11 的 render target 分配也无法在 macOS 上复现。所有 Windows 数字都是结构外推，必须按 §6.2 实测。
2. **层面积与进程内存的映射很弱**：canvas 层的面积是 CSS 盒子而非纹理尺寸，blend group 的离屏缓冲不计入层统计；不要再拿 MPx 当 MB 用（初版就是这么误判的）。
3. **"退出后保留"的性质**：强制 GC 能回收 26–45MB，说明主要是延迟回收；但 GPU 进程的 +29MB 进去一次不归还，属于 Chromium 内存池行为，只能靠减少峰值来降低。
4. **`opacity: 0` + `backdrop-filter` 是否仍分配层**：影响 P1-10 中 FocusControls 与隐藏下拉的严重度，需要用 Layers 面板确认。
5. **File 导入路径的真实触发率**：Electron 下主要走路径导入，需实测拖放与 `<input type="file">` 的分支。
6. **P1-4 歌词窗口化有持久化风险**：必须先确认落盘回填链路，分阶段推进。

---

## 8. 实施记录（本轮）

### 已实施

| 变更 | 文件 | 说明 |
|------|------|------|
| 在线封面缩略图 + 懒加载 | `src/components/BrowseView.tsx`、`src/components/search/SearchResultCards.tsx` | `toCoverThumb(url, 128/256)` + `loading="lazy" decoding="async" width/height`；网易 800×800 原图不再直出 |
| 专辑/艺术家 rail 封面 | `src/components/LibraryView.tsx`、`src/index.css` | 补 lazy/decoding/尺寸；新增 `.library-category-row`（`content-visibility: auto; contain-intrinsic-size: auto 56px`） |
| 侧边栏无效模糊 | `src/components/Sidebar.tsx` | 删除 `backdrop-blur-md`（背景恒为不透明主题色） |
| 面板重复模糊 | `src/styles/components.css` | 删除 `.app-side-panel::after` 上的第二次 `backdrop-filter` |
| 停用的 Glass UI 契约 | `src/services/settingsManager.ts` | 持久化的 `glassUI` 不再生效（恒 false），避免旧配置长期背 2 个全宽模糊层 |
| Focus 扩边画布释放 | `src/components/FocusMode.tsx` | `prepareBackdrop` 后延迟 1200ms 释放两张扩边 scratch canvas 的 backing store（避开 1000ms 入场/交叉淡入的动画帧），不再持有到卸载 |
| 滚动提交去抖 | `src/stores/libraryStore.ts`、`src/App.tsx` | 滚动只写 ref；停稳 250ms 后提交 state；切槽立即 flush 并取消失效提交；关闭落盘用 `getLiveScrollPosition()` 读实时值；新增 `test/stores/libraryStore.test.tsx` |
| 元数据缓存上限 | `src/services/metadataService.ts` | worker 缓存 50 → 8（每项含封面 ArrayBuffer） |
| 层探针工具 | `test/e2e/electron.focus-layers.spec.ts` | `FOCUS_LAYER_PROBE=1` 启用，输出层数/面积/合成原因 + GC 后各进程内存到 `test-results/memory/layer-probes/` |

### 已验证

- `npm run typecheck`、`npm run typecheck:test`、`npm run typecheck:e2e` 全部通过。
- `npm test`：97 个文件 / 656 个用例全部通过（含新增 4 个滚动提交用例）。
- `npm run check`（typecheck ×3 + 单测 + 生产构建）通过。
- 层探针 A/B（`FOCUS_LAYER_PROBE=1 npx playwright test --config=test/playwright.electron.config.ts electron.focus-layers.spec.ts`）：
  - 未覆盖 AMLL 样式：69 层 / 35.6MPx，Focus 增量 Tab +37MB、GPU +9MB（GC 后中位数）。
  - 覆盖 AMLL 负边距：69 层 / 35.35MPx —— 无收益，**已回退，未进入代码**。
  - 层数在不同采样时机下会在 69–141 之间波动，**不要用单次层数做结论**；内存结论只取 GC 后中位数。
- `electron.smoke.spec.ts` 在本机嵌套沙箱内**无法稳定通过**：它在 Focus 入场 600ms 处采样 backdrop 像素并要求 alpha ∈ [100,190]。修改后的源码得到 77，未修改的基线得到 >190（相反一侧越界），说明是该环境的帧调度噪声，不是本次改动引入的回归。同一测试在失败前已通过 preload/IPC、`cover://` 协议、Focus 挂载与 canvas 可见性等检查。

### 未实施 / 下一步

1. **§3 P1-3 的三个实验**：`mix-blend-mode` A/B、100 行 legacy 基准、背景 canvas DPR/overscan。
2. **§3 P1-4 歌词窗口化**（5k 曲库约 25–50MB JS heap，需先解决持久化回填）。
3. **§3 P1-7 主进程封面解码并发/异步化**、**P1-8 已部分完成**（上限 50→8，仍持有封面）。
4. **§4 P2 清单**：`TrackCover` memo 比较器、`MetadataView` 虚拟化、主题切换 `body *` 过渡、搜索面板卸载与 pinyin 索引、字体 404 等。
5. **Windows 实测**：按 §6.2 用 `privateBytesMb` 跑 `npm run test:memory` 与层探针，确认 P0-1/P0-2 的 D3D11 收益。

> 本仓库的 e2e 在嵌套 OS 沙箱内运行时，Electron 的 utility 进程无法初始化 Chromium 沙箱（`sandbox initialization failed: Operation not permitted`，随后 `app://` 加载失败）。层探针因此在启动参数里显式加了 `--no-sandbox`（仅测试进程，不涉及产品配置）。
