# 性能优化 TODO

> 诊断日期：2026-06-15
> 诊断方法：Chrome DevTools (JS heap ~100MB) + macOS Activity Monitor

## 诊断结果

```
Renderer   285MB  →  JS heap 100MB + 封面图片解码(183张) + 当前音频PCM缓冲
主进程     271MB  →  Node 基础 50MB + 文件读取残留 Buffers + cover:// 协议
Helper     140MB  →  GPU + 工具进程
          ──────
          ~700MB
```

关键发现：
- **DOM 节点数 1851** → 正常
- **img 标签数 183** → 220+ 首歌曲每行一张封面，全部解码
- **主进程 271MB** → `readFile` 使用 `fs.readFileSync`，每次读取整首音频文件(20-50MB)到 Buffer

---

## 优先级 1：封面图片懒加载 ⭐⭐⭐

**目标**：渲染进程降 80-150MB

封面图片全部位于 LibraryView 列表中，当前所有可见和不可见的 TrackRow 都加载了封面 `<img>`，每张图片被 Chromium 解码为未压缩 RGBA 位图后占用 GPU 内存。

方案选项：

| 方案 | 改动量 | 效果 |
|------|--------|------|
| `react-window` 虚拟列表 | 中等（需重构列表渲染） | 最好（DOM 和图片一起虚拟化） |
| `IntersectionObserver` 懒加载 | 小（改 TrackRow 组件） | 较好（图片按需加载，DOM 仍在） |

**推荐先用 IntersectionObserver 懒加载**，改动最小，立竿见影。

### 检查清单

- [ ] TrackRow 组件：封面 `<img>` 改为 observer 控制 src
- [ ] 预留占位图（低分辨率 SVG/纯色块）
- [ ] 测试快速滚动时图片加载稳定性
- [ ] 验证 cover:// 请求量降低

---

## 优先级 2：自定义 `audio://` 协议 ⭐⭐

**目标**：主进程降 50-100MB + 渲染进程降 30-50MB

当前播放流程：
```
fs.readFileSync → Buffer(主进程30MB) → IPC → ArrayBuffer(渲染进程30MB) → File → Blob URL → <audio>
```

改用自定义协议：
```
<audio src="audio://track-id"> → 主进程 fs.createReadStream + Range 支持 → 浏览器流式拉取
```

渲染进程不再持有音频二进制数据，主进程也只读取需要的范围而非整个文件。

### 参考实现

已有 `cover://` 协议（`electron/protocols/coverProtocol.ts`），按同样模式注册 `audio://` 协议：

```typescript
// electron/protocols/audioProtocol.ts
protocol.handle('audio', (request) => {
  const trackId = // 从 request.url 解析
  const filePath = // 从 trackId 查文件路径
  const stat = fs.statSync(filePath);
  const size = stat.size;

  // 支持 Range 请求（用于 seek 和流式加载）
  const range = request.headers.get('Range');
  // ... 返回 ReadableStream
});
```

### 检查清单

- [ ] 注册 `audio://` 自定义协议
- [ ] 实现 Range 请求支持
- [ ] 建立 trackId ↔ filePath 映射机制
- [ ] 修改 usePlayback 直接使用 `audio://` URL
- [ ] 移除 useBlobUrls 中的音频相关逻辑
- [ ] 验证 seek 性能不下降
- [ ] 验证切歌流畅度

---

## 优先级 3：`cover://` 协议改用流式读取 ⭐

**目标**：主进程降约 30MB

当前 `coverProtocol.ts:36` 使用 `fs.readFileSync` 读取封面文件，改为 `fs.createReadStream`。

---

## 优先级 4：切歌时释放 `<audio>` 解码缓冲 ⭐

**目标**：渲染进程降约 50MB

切歌时主动清空 `<audio>` 的 src，释放 Chromium 音频管线中缓存的 PCM 解码数据。注意仅在切歌时做，不在 seek/拖动进度条时做。

### 检查清单

- [ ] 切歌时执行 `audioRef.current.src = ''` + `load()`
- [ ] 验证 seek 不受影响（拖动进度条不做此操作）
- [ ] 确认不会引入卡顿

---

## 长期：主进程内存基线

- 排查 `libraryStorage` 加载时是否有不必要的全量文件读取
- 排查 `coverArtService.extractAndCacheCover` 是否存在音频大文件二次读取
