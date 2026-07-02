# 全新 UI/UX 样式结构重构计划

## 目标

在保留现有 UI 的前提下，新增一套可通过实验性开关启用的全新 UI/UX。新 UI 的核心体验是：启动后进入 MainView 歌单空间，取消 Sidebar，歌曲列表和播放器都以浮动面板形式存在，并为 ControlBar 到 FocusMode 建立连续、可感知的过渡动画。

本计划优先保证现有播放、导入、WebDAV、在线歌曲、歌词同步、元数据编辑和删除逻辑不被破坏。新 UI 先复用现有业务能力，再逐步替换视觉结构和交互组织。

## 总体原则

1. 旧 UI 必须保留
   - 新 UI 由实验性功能开关控制。
   - 关闭开关时，现有 Sidebar、ControlBar、LibraryView、FocusMode 行为保持不变。
   - 新 UI 的组件、样式和状态尽量独立，避免把旧 UI 改成半新半旧的中间态。

2. 业务逻辑先复用，视觉结构后替换
   - 播放状态、库槽位、导入、WebDAV 同步、删除文件、元数据写入等逻辑继续从现有 store 和 handler 接入。
   - 新 UI 优先重组布局、面板层级、菜单入口和动画，不重写播放器状态机。

3. 同一时刻只展示一个歌曲列表浮动面板
   - MainView 中点击任意歌单卡片，如果当前已有歌曲列表面板，则关闭当前面板，再打开新的歌单面板。
   - 列表面板关闭后，MainView 保持在原位置，不切换到旧的 ViewMode 页面。

4. 编辑和删除确认不嵌在歌曲列表内部
   - 元数据编辑面板、删除二次确认面板与歌曲列表面板处于同一层级。
   - 它们通过 PanelStack 并行叠放，而不是作为歌曲列表内部 modal 出现。

5. 右键菜单是新 UI 的主要管理入口
   - 导入文件入口迁移到 local/cloud 歌单卡片的右键菜单。
   - 歌曲编辑、删除、批量选择也通过右键菜单组织。
   - 编辑模式下的右键菜单只保留“返回”和“删除”。

6. FocusMode 过渡必须连续
   - 从浮动播放器封面进入 FocusMode 时，不做简单淡入切页。
   - 需要表现为播放器边框向四周展开，成为 FocusMode 背景容器。
   - 封面、TITLE、ARTIST、ALBUM、播放控件在过渡中移动并放大到 FocusMode 对应位置。
   - 歌词在展开完成后淡入。
   - FocusMode 必须继续兼容老页面样式：默认调用路径保持 legacy 外观和行为，新 UI 的流光背景、过渡层和结构拆分通过可选插槽、wrapper 或新 UI 专属组件接入。

## 当前代码落点

主要现有文件：

- `AppWorkspace.tsx`
  - 当前应用状态和 UI 接线中心。
  - 新 UI 开关后，可以在这里分流旧 shell 和新 shell。

- `stores/uiStore.ts`
  - 当前维护 `viewMode`、`isFocusMode`、页面切换、窗口 focus、floatingPanel、glassUI 等 UI 状态。
  - 新 UI 可以在这里接入 `newUxEnabled`，但新 UI 内部面板状态建议独立 hook 管理。

- `services/settingsManager.ts`
  - 已有实验性开关和订阅机制。
  - 适合新增 `newUxEnabled` 持久化字段。

- `components/SettingsView.tsx`
  - 实验性功能区域已存在。
  - 新增“全新 UI/UX”开关。

- `components/LibraryView.tsx`
  - 现有歌曲列表逻辑复杂，包含虚拟滚动、拖拽排序、编辑模式、删除确认、元数据编辑、云端刷新、定位等。
  - 新 UI 第一阶段应包装复用，不直接重写全部列表逻辑。

- `components/Controls.tsx`
  - 旧 ControlBar。
  - 新 UI 新建 `FloatingPlayerPanel`，复用同一组播放 props。

- `components/FocusMode.tsx`
  - 当前 FocusMode 体量较大，包含歌词同步、canvas 背景、设置订阅、播放器控件等。
  - 新 UI 过渡和流光背景需要逐步抽分，不建议一次性重写。

## 新增目录建议

```text
components/
  new-ui/
    NewUxShell.tsx
    MainView.tsx
    PlaylistCard.tsx
    PlaylistPanel.tsx
    PlaylistPanelHost.tsx
    FloatingPlayerPanel.tsx
    LocateNowPlayingButton.tsx
    PanelStack.tsx
    ContextMenu.tsx
    TrackContextMenu.tsx
    PlaylistCardContextMenu.tsx
    MetadataEditPanel.tsx
    DeleteConfirmPanel.tsx
    focus/
      FocusTransitionLayer.tsx
      FocusBackdrop.tsx
      FocusAmbientLight.tsx
      FocusCoverStage.tsx
      FocusTrackMeta.tsx
      FocusLyrics.tsx
      FocusControls.tsx
hooks/
  new-ui/
    useNewUxEnabled.ts
    useNewUxPanels.ts
    usePlaylistEntries.ts
    useFocusTransition.ts
    useNowPlayingLocator.ts
styles/
  tokens.css
  base.css
  layout.css
  components.css
  animations.css
```

## 阶段 1：实验性开关和样式结构拆分

### 目标

建立新 UI 的开关和样式基础设施。此阶段不改变默认体验。

### 实施内容

1. 在 `settingsManager` 中新增：
   - `NEW_UX_ENABLED_KEY`
   - `private newUxEnabled = false`
   - `getNewUxEnabled()`
   - `setNewUxEnabled(enabled: boolean)`
   - `loadFromStorage()` 读取字段
   - `notify()` 触发订阅

2. 在 `SettingsView` 实验性功能区域新增开关：
   - 文案：`全新 UI/UX`
   - 描述：`启用新的歌单空间、浮动面板和沉浸式播放过渡。关闭后恢复旧界面。`
   - 中英文 i18n 同步补齐。

3. 新增 `useNewUxEnabled`：
   - 初始化读取 `settingsManager.getNewUxEnabled()`
   - 订阅 settings 变化
   - 返回 `newUxEnabled`

4. `AppWorkspace` 根据 `newUxEnabled` 分流：
   - `false`：渲染旧 UI。
   - `true`：渲染 `NewUxShell`。

5. 样式文件拆分：
   - `index.css` 保留 `@import "tailwindcss";` 和对新样式文件的 import。
   - 先移动全局 token、base、动画，不做大规模视觉改动。

### 验收

- 默认打开应用仍是旧 UI。
- 设置中可以打开/关闭“全新 UI/UX”。
- 开关刷新后仍保持。
- `npx tsc --noEmit` 通过。

## 阶段 2：NewUxShell 和 MainView 歌单空间

### 目标

打开新 UI 后，启动进入 MainView。MainView 展示所有歌单入口，本地音频和云端音乐也以在线歌单样式呈现。

### PlaylistEntry 模型

```ts
type PlaylistEntryKind = 'local' | 'cloud' | 'online' | 'playlist';

interface PlaylistEntry {
  id: string;
  kind: PlaylistEntryKind;
  title: string;
  subtitle: string;
  count: number;
  coverUrls: string[];
  accent?: string;
  disabled?: boolean;
  disabledReason?: string;
}
```

### 数据来源

- local：`slots.local.tracks`
- cloud：`slots.cloud.tracks`
- online：`slots.online.tracks`
- 用户歌单：复用现有歌单数据来源，若当前结构不足，第一版可先展示本地、云端、在线播放三个入口。

### MainView 视觉

1. 第一版：
   - 使用稳定的堆叠卡片布局。
   - 支持滚动。
   - 卡片尺寸可以有主次层级，但位置使用确定性规则，避免每次进入随机跳动。

2. 第二版：
   - 升级成类似 Apple Watch 应用导航页。
   - 不同歌单不规则摆放或堆叠。
   - 支持触控板/滚轮平滑浏览。

### MainView 交互

1. 左键点击歌单卡片：
   - 如果没有列表面板，打开对应 `PlaylistPanel`。
   - 如果已有其他列表面板，先关闭旧面板，再打开新面板。
   - 如果点击当前已打开的歌单，可以保持打开，或执行轻微聚焦动画。

2. 右键点击 local 卡片：
   - `导入本地音频`
   - `打开本地歌曲列表`
   - 可选：`重新加载不可用歌曲`

3. 右键点击 cloud 卡片：
   - `导入到云端/上传音频`
   - `刷新云端歌曲`
   - `打开云端歌曲列表`
   - 如果 WebDAV 未配置，导入/刷新入口应提示并跳转设置。

4. 右键点击 online 卡片：
   - `打开在线播放列表`
   - 可选：`清空播放历史`

### 验收

- 新 UI 打开后不显示 Sidebar。
- MainView 至少展示 local、cloud、online 三个歌单入口。
- local/cloud 导入入口不再依赖 Sidebar。
- 点击不同歌单时，同时只存在一个歌曲列表面板。

## 阶段 3：歌曲列表浮动面板

### 目标

点击歌单后打开一个浮动歌曲列表面板。面板只展示歌曲列表，不承载编辑弹窗和删除确认弹窗。

### 面板规则

1. 同时只允许一个 `PlaylistPanel`。
2. 打开新的歌单面板时，关闭旧面板。
3. 面板关闭后回到 MainView。
4. 面板不改变旧 UI 的 `ViewMode` 页面结构。
5. 面板内部只展示：
   - 歌曲列表
   - 极简标题区
   - 搜索/筛选/排序入口
   - 当前列表状态

### 与 LibraryView 的关系

第一版可以包装 `LibraryView`，但需要为新 UI 增加适配参数：

- 隐藏旧列表中的定位按钮。
- 隐藏或弱化旧 toolbar 中的编辑入口。
- 将元数据编辑和删除确认改为外部 panel 控制。
- 保留虚拟滚动、拖拽排序、当前播放高亮、批量选择能力。

如果直接改造 `LibraryView` 风险太高，则创建 `NewPlaylistList`：

- 复用 `LibraryTrackRow`
- 复用 `useLibraryVirtualScroll`
- 只实现新 UI 需要的列表能力
- 第二轮再迁移拖拽排序、分类筛选等高级能力

### 面板层级

```text
MainView
  PlaylistPanel
  MetadataEditPanel
  DeleteConfirmPanel
  ContextMenu
FloatingPlayerPanel
LocateNowPlayingButton
FocusTransitionLayer
```

其中 `PlaylistPanel`、`MetadataEditPanel`、`DeleteConfirmPanel` 是同层并行面板，由 `PanelStack` 统一管理 z-index、进入/退出动画和焦点。

### 验收

- 列表面板可以打开、关闭、切换歌单。
- 列表面板中不显示旧的定位按钮。
- 元数据编辑和删除确认不出现在列表面板内部。
- 当前播放歌曲仍能高亮。

## 阶段 4：右键菜单和编辑模式

### 目标

将歌曲管理能力迁移到右键菜单。编辑模式也通过右键菜单进入。

### 歌曲普通模式右键菜单

单曲右键：

- `播放`
- `下一首播放`，可延后
- `编辑`
- `删除`
- `从列表移除`，如现有业务区分需要

多选右键：

- `播放选中第一首`
- `删除选中`
- `退出选择`

点击 `编辑`：

- 歌曲列表进入编辑模式。
- 显示选择框或多选状态。
- 不立即打开元数据编辑面板，除非用户针对单曲选择“编辑元数据”。

### 编辑模式右键菜单

编辑模式下，右键菜单只提供：

- `返回`
- `删除`

约束：

- 不展示播放、下一首、编辑元数据等普通操作。
- `返回` 退出编辑模式并清空选中。
- `删除` 打开删除二次确认面板。

### 删除确认

删除仍参考现有方案：

- 必须二次确认。
- 支持勾选 `同时删除本地文件`。
- 对 cloud/webdav/online 来源需要按现有能力决定是否显示“删除本地文件”。
- 删除面板与歌曲列表同层，由 `PanelStack` 管理，不嵌入列表窗口。

### 元数据编辑

元数据编辑面板：

- 与歌曲列表同层展示。
- 类卡片样式堆叠。
- 保存后更新列表项和播放中曲目信息。
- 关闭时返回列表上下文，不关闭歌曲列表面板。

### 验收

- 普通模式右键菜单包含编辑和删除。
- 点击编辑后进入编辑模式。
- 编辑模式右键菜单只包含返回和删除。
- 删除确认可以勾选是否删除本地文件。
- 编辑面板、删除确认面板都不出现在列表面板内部。

## 阶段 5：独立定位按钮

### 目标

定位按钮从歌曲列表浮动面板中移除，变成固定在屏幕上的小按钮。它负责定位当前正在播放的音频。

### 显示条件

按钮仅在满足以下条件之一时显示：

1. 当前正在播放的歌曲不在已打开列表面板的可视区域内。
2. 当前打开的列表面板不是正在播放歌曲所在的歌单。
3. 当前没有打开列表面板，但存在当前播放歌曲。

### 点击行为

1. 如果当前列表面板打开的是正在播放歌曲所在歌单：
   - 滚动列表到当前播放歌曲。

2. 如果当前列表面板打开的是其他歌单：
   - 关闭其他歌单列表面板。
   - 打开当前播放歌曲所在歌单的列表面板。
   - 等待列表内容 ready 后滚动定位到当前播放歌曲。

3. 如果当前没有列表面板：
   - 打开当前播放歌曲所在歌单的列表面板。
   - 滚动定位到当前播放歌曲。

### 需要维护的状态

```ts
interface NowPlayingLocateState {
  visible: boolean;
  targetPlaylistId: string | null;
  targetTrackId: string | null;
  pendingLocateToken: number;
}
```

### 注意点

- 当前播放歌曲可能来自 local、cloud、online。
- `viewSlot` 和 `activeSlotId` 可能不同，需要以 `currentTrack` 的 source/id 判定真实归属。
- 列表面板切换后要等待虚拟列表完成测量再滚动。

### 验收

- 定位按钮不显示在列表面板内部。
- 播放歌曲不在当前列表可视范围时，固定按钮出现。
- 点击按钮可以打开正确歌单并滚动到当前播放歌曲。
- 打开其他歌单后点击定位，会关闭其他列表并打开当前播放歌曲所属列表。

## 阶段 6：浮动播放器面板

### 目标

新 UI 中取消拉满宽度的 ControlBar，改为浮动播放器面板。

### 组件拆分

- `FloatingPlayerPanel`
- `MiniPlayerCover`
- `MiniPlayerMeta`
- `MiniTransportControls`
- `MiniProgress`
- `MiniVolume`

### 默认布局

- 面板浮动在屏幕底部中间或右下。
- 不拉满窗口宽度。
- 封面、TITLE、ARTIST、播放/暂停、上一首、下一首、进度条必须完整可用。
- ALBUM 在空间允许时显示；进入 FocusMode 过渡时必须参与动画。

### 交互

- 点击封面：进入 FocusMode 过渡。
- 点击播放按钮：播放/暂停。
- 进度条拖动：seek。
- 音量和播放模式可保留在二级区域或紧凑按钮中。

### 验收

- 新 UI 不渲染旧底部长条 ControlBar。
- 浮动播放器不遮挡歌曲列表的核心内容。
- 点击封面可以触发 FocusMode 过渡。

## 阶段 7：ControlBar 到 FocusMode 的连续过渡

### 目标

实现从浮动播放器进入 FocusMode 的连续动画。

### 动画时序

1. 点击浮动播放器封面。
2. 记录起点元素位置：
   - 播放器面板外框
   - 封面
   - TITLE
   - ARTIST
   - ALBUM
   - 播放/暂停、上一首、下一首、进度条
3. 预渲染 FocusMode 目标布局，但先隐藏真实内容。
4. 记录终点元素位置。
5. 播放器边框向四周扩大，成为 FocusMode 背景容器。
6. 毛玻璃不透明度随展开进度增加。
7. 封面图片颜色采样后的高斯模糊新增过渡动画：
   - blur radius 从低到高
   - opacity 从低到高
   - saturation 轻微提升
8. 封面从 mini 位置移动并放大到 FocusMode 封面位置。
9. TITLE、ARTIST、ALBUM 跟随移动并放大。
10. 播放控件移动到 FocusMode 控件目标区域。
11. FocusMode 中真实 controlbar 淡入。
12. 滚动歌词淡入。

### 实现建议

使用 FLIP：

- First：记录 mini 状态 rect。
- Last：记录 focus 状态 rect。
- Invert：通过 transform 抵消差值。
- Play：transform 归零。

需要新增：

```ts
interface FocusTransitionSnapshot {
  panel: DOMRect;
  cover: DOMRect;
  title: DOMRect;
  artist: DOMRect;
  album: DOMRect | null;
  controls: DOMRect;
  progress: DOMRect;
}
```

### 退出 FocusMode

第一版可以先做淡出返回。
第二版再做反向 FLIP 回到浮动播放器。

### 验收

- 进入 FocusMode 时不是简单切页。
- 播放器边框有向四周扩大的过程。
- 封面、TITLE、ARTIST、ALBUM 有连续位移和缩放。
- 歌词在展开完成后淡入。
- 播放不中断。

## 阶段 8：FocusMode 结构拆分和流光背景

### 目标

降低 `FocusMode.tsx` 复杂度，并加入流光背景。

### 兼容约束

- 老 UI 继续使用 `FocusMode` 的默认 legacy 样式，不强制启用新 UI 的流光背景或过渡层。
- 新 UI 专属增强优先通过可选 prop、插槽或 wrapper 注入，避免把 `FocusMode.tsx` 改成只适配新 UI 的实现。
- 拆分子组件时，保留旧调用方式的默认行为；新组件可以逐步承接逻辑，但不能让旧 UI 出现视觉回退。

### 拆分建议

- `FocusModeShell`
  - 管理 visible、进入/退出状态。

- `FocusBackdrop`
  - 负责封面背景、canvas、模糊、透明度。

- `FocusAmbientLight`
  - 负责流光动效。

- `FocusCoverStage`
  - 负责封面展示和动画目标位。

- `FocusTrackMeta`
  - 展示 TITLE、ARTIST、ALBUM。

- `FocusLyrics`
  - 负责滚动歌词。
  - 保留现有歌词同步逻辑，不在第一轮重写。

- `FocusControls`
  - 播放控制、进度、音量、播放模式。

### 流光背景规则

- 播放时：流光缓慢移动，亮度较高。
- 暂停时：速度降低，透明度降低。
- 切歌时：重新采样封面色，平滑过渡。
- 性能优先：第一版使用 CSS gradient + transform；如效果不足，再考虑 canvas。

### 验收

- FocusMode 背景有流光动效。
- 播放/暂停会影响流光强度。
- 切歌背景过渡柔和。
- 歌词同步不回退。

## 阶段 9：清理旧样式耦合

### 目标

新 UI 可用后，清理重复和临时样式，但仍保留旧 UI。

### 内容

- 将新 UI 样式收敛到 `styles/components.css` 和 `styles/animations.css`。
- 避免在新 UI 组件中继续大量写 inline style。
- 保留主题变量能力，让新 UI 可以响应现有主题。
- 不删除旧 Sidebar/Controls，除非后续确认旧 UI 下线。

### 验收

- 新旧 UI 都可运行。
- 样式文件分层清晰。
- 新 UI 没有明显的 Tailwind 超长 class 串失控问题。

## 状态模型建议

新 UI 内部建议维护一个独立 hook：`useNewUxPanels`。

```ts
type PanelKind = 'playlist' | 'metadata-edit' | 'delete-confirm';

interface OpenPlaylistPanel {
  playlistId: string;
  slotId?: SlotId;
}

interface NewUxPanelState {
  openPlaylist: OpenPlaylistPanel | null;
  editingTrackId: string | null;
  deleteTargetIds: string[];
  isEditMode: boolean;
  selectedTrackIds: Set<string>;
}
```

关键规则：

- `openPlaylist` 同时只能有一个。
- 打开新 playlist 时清理 context menu，但不必强制退出播放。
- 打开 metadata/delete panel 时不关闭 playlist panel。
- 关闭 playlist panel 时，同时关闭依附于该 playlist 的 metadata/delete panel。
- 进入编辑模式时保留当前 playlist panel。
- 退出编辑模式时清空 `selectedTrackIds`。

## 右键菜单详细规则

### PlaylistCardContextMenu

local：

- `打开列表`
- `导入本地音频`
- `重新加载不可用歌曲`，仅存在不可用歌曲时显示

cloud：

- `打开列表`
- `导入到云端`
- `刷新云端歌曲`
- `WebDAV 设置`，未配置时优先显示

online：

- `打开列表`
- `清空在线播放历史`，可延后

用户歌单：

- `打开列表`
- `重命名`，可延后
- `删除歌单`，可延后

### TrackContextMenu 普通模式

- `播放`
- `编辑`
- `删除`
- `进入编辑模式`

### TrackContextMenu 编辑模式

- `返回`
- `删除`

## 风险和控制

1. `LibraryView` 体量大
   - 风险：直接改容易影响旧 UI。
   - 控制：通过新 UI wrapper 或新组件分阶段迁移。

2. FocusMode 过渡复杂
   - 风险：动画和真实 DOM 状态不一致。
   - 控制：先做单向进入动画，反向退出延后。

3. 定位按钮涉及虚拟滚动
   - 风险：列表未 ready 时滚动失败。
   - 控制：使用 pending locate token，等待列表内容 ready 后再滚动。

4. 新旧 UI 状态分流
   - 风险：切换开关时残留 panel/focus 状态。
   - 控制：关闭新 UI 时重置新 UI panel 状态，并退出 FocusMode。

5. 右键菜单和编辑模式
   - 风险：普通菜单和编辑菜单混用。
   - 控制：菜单内容完全由 `isEditMode` 分支生成。

## 推荐里程碑

### Milestone 1：新 UI 骨架

- 新 UI 开关
- 样式目录拆分
- `NewUxShell`
- `MainView`
- local/cloud/online 歌单卡片
- 点击卡片打开单个 `PlaylistPanel`

### Milestone 2：列表面板和右键菜单

- 歌单卡片右键菜单
- local/cloud 导入入口迁移
- 歌曲右键菜单
- 编辑模式菜单规则
- 删除确认面板同层展示
- 元数据编辑面板同层展示

### Milestone 3：定位和浮动播放器

- 独立定位按钮
- 点击定位打开正确歌单并滚动
- `FloatingPlayerPanel`
- 新 UI 不再显示旧 ControlBar

### Milestone 4：FocusMode 过渡

- mini player 到 FocusMode 单向 FLIP 动画
- 边框扩展为背景
- 封面、TITLE、ARTIST、ALBUM 移动放大
- 控件移动并淡入
- 歌词延迟淡入

### Milestone 5：FocusMode 背景和收尾

- FocusMode 组件拆分
- 流光背景
- 封面采样高斯模糊过渡
- 新旧 UI QA
- 样式清理

## 每轮实现后的检查清单

- `npx tsc --noEmit`
- 新 UI 开关打开/关闭正常。
- 旧 UI 行为没有回退。
- local/cloud/online 三类歌曲入口可打开。
- 同时只存在一个歌曲列表面板。
- 导入入口在 local/cloud 卡片右键菜单中可触发。
- 普通右键菜单和编辑模式右键菜单符合约束。
- 删除确认支持是否删除本地文件。
- 元数据编辑和删除确认与列表同层展示。
- 定位按钮可以打开正确列表并滚动到当前播放歌曲。
- 浮动播放器不拉满，不遮挡列表核心操作。
- FocusMode 进入动画播放期间音频不中断。
